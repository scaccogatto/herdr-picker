import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from '@playwright/test'
import { chromium, expect } from '@playwright/test'
import { hostManifest, wrapperScript } from '../../src/cli.ts'
import { HOST_NAME } from '../../src/host-name.ts'
import type { FakeHerdr } from '../../src/__tests__/helpers/fake-herdr.ts'
import { startFakeHerdr } from '../../src/__tests__/helpers/fake-herdr.ts'

const EXTENSION_ID = 'mankcecpkemjnmhfpcehhkfnhohdnefh'

export interface RawReceived {
  method: string
  params: Record<string, unknown>
}

export interface Harness {
  context: BrowserContext
  page: Page
  fake: FakeHerdr
  sentPrompts(): { target: string; text: string }[]
  raw(): RawReceived[]
  close(): Promise<void>
}

const FIXTURE_HTML = `<!doctype html><html><head><title>pick</title><style>body{margin:40px;font:16px sans-serif}.btn{padding:8px 16px;background:#6e56cf;color:#fff;border:0;border-radius:6px}</style></head><body><main><h1>Settings</h1><form class="settings"><label>Name <input id="name" value="Marco"></label><p class="note"><span class="note-text">Saved locally</span></p><button id="save" class="btn btn-primary" type="button">Save</button></form></main></body></html>`

export async function launchExtension(opts: {
  snapshot: (received: RawReceived[]) => unknown
  handlers?: Record<string, (params: Record<string, unknown>) => unknown>
  installHost?: boolean
  html?: string
}): Promise<Harness> {
  // Assert that the extension is built
  const dist = fileURLToPath(new URL('../../dist/', import.meta.url))
  const extensionDist = join(dist, 'extension')
  const manifestPath = join(extensionDist, 'manifest.json')
  const hostJsPath = join(dist, 'host.js')

  if (!existsSync(manifestPath)) {
    throw new Error('run npm run build before the e2e')
  }
  if (!existsSync(hostJsPath)) {
    throw new Error('run npm run build before the e2e')
  }

  // Start fake herdr
  const fake = await startFakeHerdr({
    'session.snapshot': () => opts.snapshot(fake.received),
    'agent.prompt': (params) => ({
      type: 'agent_prompted',
      agent: { pane_id: params.target, terminal_title_stripped: 'Settings polish' },
    }),
    ...opts.handlers,
  })

  // Setup temp dir and profile
  const tempDir = tmpdir()
  const testDir = `${tempDir}/herdr-picker-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  mkdirSync(testDir, { recursive: true })

  const userDataDir = join(testDir, 'profile')
  mkdirSync(userDataDir, { recursive: true })

  // Copy and patch extension
  const extDir = join(testDir, 'ext')
  cpSync(extensionDist, extDir, { recursive: true })

  // Patch manifest to add host_permissions
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'))
  manifest.host_permissions = ['<all_urls>']
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest))

  // Setup native host if requested
  if (opts.installHost !== false) {
    const hostShPath = join(testDir, 'host.sh')
    const wrapper = wrapperScript({
      nodePath: process.execPath,
      hostJs: hostJsPath,
      socketPath: fake.socketPath,
    })
    writeFileSync(hostShPath, wrapper, 'utf8')
    chmodSync(hostShPath, 0o755)

    const nativeMessagingHostsDir = join(userDataDir, 'NativeMessagingHosts')
    mkdirSync(nativeMessagingHostsDir, { recursive: true })

    const manifestJson = hostManifest({ hostScript: hostShPath, extensionId: EXTENSION_ID })
    writeFileSync(
      join(nativeMessagingHostsDir, `${HOST_NAME}.json`),
      JSON.stringify(manifestJson),
      'utf8',
    )
  }

  // Launch browser
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  })

  // Setup route for test page
  await context.route('http://127.0.0.1/**', (route) => {
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: opts.html ?? FIXTURE_HTML,
    })
  })

  // Create page and navigate
  const page = await context.newPage()
  await page.goto('http://127.0.0.1/pick.html')

  // Return harness
  return {
    context,
    page,
    fake,
    sentPrompts() {
      return fake.received
        .filter((msg) => msg.method === 'agent.prompt')
        .map((msg) => ({
          target: String(msg.params.target ?? ''),
          text: String(msg.params.text ?? ''),
        }))
    },
    raw() {
      return fake.received
    },
    async close() {
      await context.close()
      await fake.close()
      // Clean up temp dir
      const fs = await import('node:fs/promises')
      await fs.rm(testDir, { recursive: true, force: true })
    },
  }
}

export async function triggerPick(context: BrowserContext, page: Page): Promise<void> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))

  const tabId = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' })
    return tabs[0]?.id
  })

  if (tabId === undefined) {
    throw new Error('Could not find tab with test URL')
  }

  await sw.evaluate((id) => {
    return (globalThis as unknown as { __herdrPick(id: number): Promise<void> }).__herdrPick(id)
  }, tabId)

  await expect(page.locator('[data-herdr-host]')).toBeAttached()
}

export async function pickSaveButton(page: Page): Promise<void> {
  const saveButton = page.locator('#save')
  const boundingBox = await saveButton.boundingBox()

  if (!boundingBox) {
    throw new Error('Save button not found or not visible')
  }

  const centerX = boundingBox.x + boundingBox.width / 2
  const centerY = boundingBox.y + boundingBox.height / 2

  await page.mouse.move(centerX, centerY)
  await page.mouse.click(centerX, centerY)

  await (await pickerUi(page)).waitVisible('.popup')
}

export function liveSnapshot(status: 'idle' | 'working'): unknown {
  return {
    type: 'session_snapshot',
    snapshot: {
      version: '0.8.2',
      protocol: 20,
      focused_workspace_id: 'w1',
      focused_pane_id: 'w1:p1',
      workspaces: [{ workspace_id: 'w1', label: 'app', number: 1, focused: true }],
      tabs: [],
      panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', focused: true, cwd: '/tmp/proj' }],
      layouts: [],
      agents: [
        {
          pane_id: 'w1:p2',
          workspace_id: 'w1',
          agent_status: status,
          focused: false,
          agent: 'claude',
          cwd: '/tmp/proj',
          terminal_title_stripped: 'Settings polish',
          tokens: { branch: 'main' },
          agent_session: { value: 's1' },
        },
      ],
    },
  }
}

interface CdpNode {
  nodeId: number
  attributes?: string[]
  children?: CdpNode[]
  shadowRoots?: CdpNode[]
}

function findHost(node: CdpNode): CdpNode | null {
  if (node.attributes?.includes('data-herdr-host') === true) return node
  for (const child of node.children ?? []) {
    const found = findHost(child)
    if (found !== null) return found
  }
  return null
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Reaches into the picker's closed shadow root over CDP (Playwright locators
 * only pierce open roots). Clicks go through page.mouse, so they stay trusted.
 */
export interface PickerUi {
  /** Bounding box of the first match, or null when it is missing or not rendered */
  box(selector: string): Promise<Box | null>
  /** Text content of the first match, or null when it is missing */
  text(selector: string): Promise<string | null>
  /** Waits until the first match is rendered, then clicks its center */
  click(selector: string): Promise<void>
  /** Waits until the first match is rendered */
  waitVisible(selector: string, timeout?: number): Promise<void>
}

export async function pickerUi(page: Page): Promise<PickerUi> {
  const cdp = await page.context().newCDPSession(page)

  async function find(selector: string): Promise<number | null> {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: CdpNode }
    const shadow = findHost(root)?.shadowRoots?.[0]
    if (shadow === undefined) return null
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: shadow.nodeId, selector })
    return nodeId === 0 ? null : nodeId
  }

  async function box(selector: string): Promise<Box | null> {
    const nodeId = await find(selector)
    if (nodeId === null) return null
    try {
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId })
      const xs = [model.border[0], model.border[2], model.border[4], model.border[6]] as number[]
      const ys = [model.border[1], model.border[3], model.border[5], model.border[7]] as number[]
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    } catch {
      // no layout box: display:none or detached
      return null
    }
  }

  async function waitVisible(selector: string, timeout = 5000): Promise<void> {
    await expect.poll(async () => ((await box(selector))?.width ?? 0) > 0, { timeout, message: `${selector} visible` }).toBe(true)
  }

  return {
    box,
    waitVisible,
    async text(selector) {
      const nodeId = await find(selector)
      if (nodeId === null) return null
      const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId })
      return outerHTML.replace(/<[^>]*>/g, '')
    },
    async click(selector) {
      await waitVisible(selector)
      const b = await box(selector)
      if (b === null) throw new Error(`${selector} disappeared before the click`)
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    },
  }
}
