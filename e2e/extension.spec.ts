import { expect, test } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'
import type { Harness } from './helpers/extension.ts'
import { launchExtension, triggerPick, pickSaveButton, liveSnapshot, pickerUi } from './helpers/extension.ts'

let harness: Harness | undefined

test.afterEach(async () => {
  if (harness) {
    await harness.close()
    harness = undefined
  }
})

test('sends the picked element to the agent and shows DONE', async () => {
  let snapshotsAfterPrompt = 0

  harness = await launchExtension({
    snapshot: (received) => {
      // Count snapshots after the first prompt
      const promptIndex = received.findIndex((msg) => msg.method === 'agent.prompt')
      if (promptIndex >= 0) {
        snapshotsAfterPrompt = received.filter((msg, i) => i > promptIndex && msg.method === 'session.snapshot').length
      }

      // Return working status until we have 2 snapshots after the prompt
      if (promptIndex < 0) {
        return liveSnapshot('working')
      }

      return snapshotsAfterPrompt >= 2 ? liveSnapshot('idle') : liveSnapshot('working')
    },
  })

  const { page } = harness

  // Trigger picker
  await triggerPick(harness.context, page)

  // Pick the save button
  await pickSaveButton(page)

  const ui = await pickerUi(page)

  // Wait for screenshot row to be visible (indicates state has been fetched)
  await ui.waitVisible('.shot-row')

  // Type prompt into the textarea (trusted input over CDP)
  await ui.click('.popup textarea')
  await page.keyboard.insertText('Make it green')

  // Click the Send button
  await ui.click('.send-btn')

  // Wait for prompt to be sent
  await expect.poll(() => harness!.sentPrompts().length).toBe(1)

  const prompts = harness.sentPrompts()
  const prompt = prompts[0]

  expect(prompt).toBeDefined()
  if (prompt) {
    expect(prompt.target).toBe('w1:p2')
    expect(prompt.text).toContain('[herdr-picker] http://127.0.0.1/pick.html')
    expect(prompt.text).toContain('Focus: none, find by selector')
    expect(prompt.text).toContain('Element: button#save')
    expect(prompt.text).toContain('data-herdr-picked=""')
    expect(prompt.text).toMatch(/---\nMake it green$/)
  }

  // Wait for DONE chip
  await ui.waitVisible('.inflight-chip.done', 10_000)
})

test('attaches a real-pixel screenshot when the switch is on', async () => {
  let snapshotsAfterPrompt = 0

  harness = await launchExtension({
    snapshot: (received) => {
      const promptIndex = received.findIndex((msg) => msg.method === 'agent.prompt')
      if (promptIndex >= 0) {
        snapshotsAfterPrompt = received.filter((msg, i) => i > promptIndex && msg.method === 'session.snapshot').length
      }

      if (promptIndex < 0) {
        return liveSnapshot('working')
      }

      return snapshotsAfterPrompt >= 2 ? liveSnapshot('idle') : liveSnapshot('working')
    },
  })

  const { page } = harness

  // Trigger picker
  await triggerPick(harness.context, page)

  // Pick the save button
  await pickSaveButton(page)

  const ui = await pickerUi(page)

  // Check the screenshot checkbox (visible when state reports screenshot available)
  await ui.click('.shot-row input[type=checkbox]')

  // Type prompt
  await ui.click('.popup textarea')
  await page.keyboard.insertText('Make it green')

  // Click the Send button
  await ui.click('.send-btn')

  // Wait for prompt to be sent
  await expect.poll(() => harness!.sentPrompts().length).toBe(1)

  const prompts = harness.sentPrompts()
  const prompt = prompts[0]

  expect(prompt).toBeDefined()
  if (!prompt) return

  // Verify screenshot line is present
  const screenshotMatch = prompt.text.match(/^Screenshot: (\S+\.png) \(real pixels, the picked element is outlined, 40px margin\)$/m)
  expect(screenshotMatch).not.toBeNull()

  const screenshotPath = screenshotMatch?.[1]
  expect(screenshotPath).toBeDefined()

  // Verify screenshot file exists and is valid
  if (screenshotPath) {
    try {
      const stats = statSync(screenshotPath)
      expect(stats.size).toBeGreaterThan(100)

      // Check PNG magic bytes
      const buffer = readFileSync(screenshotPath)
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      expect(buffer.subarray(0, 4).equals(pngMagic)).toBe(true)
    } catch (err) {
      throw new Error(`Screenshot file validation failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      })
    }
  }

  // Wait for DONE chip
  await ui.waitVisible('.inflight-chip.done', 10_000)
})

test('remembers the screenshot switch in extension storage, not in the page', async () => {
  harness = await launchExtension({ snapshot: () => liveSnapshot('idle') })
  const { page } = harness

  await triggerPick(harness.context, page)
  await pickSaveButton(page)
  const ui = await pickerUi(page)
  await ui.click('.shot-row input[type=checkbox]')

  const sw = harness.context.serviceWorkers()[0] ?? (await harness.context.waitForEvent('serviceworker'))
  await expect
    .poll(() => sw.evaluate(() => chrome.storage.local.get('shot:http://127.0.0.1')))
    .toEqual({ 'shot:http://127.0.0.1': true })
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('a hostile page cannot read the popup or steer the target', async () => {
  const twoAgents = (): unknown => {
    const snap = liveSnapshot('idle') as { snapshot: { agents: Record<string, unknown>[] } }
    const first = snap.snapshot.agents[0] ?? {}
    snap.snapshot.agents.push({ ...first, pane_id: 'w1:p3', terminal_title_stripped: 'Other task', agent_session: { value: 's2' } })
    return snap
  }
  harness = await launchExtension({ snapshot: twoAgents })
  const { page } = harness

  // The old builds read the preselection from the page's own localStorage
  await page.evaluate(() => localStorage.setItem('herdr:last', JSON.stringify({ pane_id: 'w1:p3', session: 's2' })))

  await triggerPick(harness.context, page)
  await pickSaveButton(page)
  const ui = await pickerUi(page)
  await ui.waitVisible('.shot-row')

  // The page sees the host element but not its shadow root, so it cannot read or click the agent rows
  const reach = await page.evaluate(() => {
    const host = document.querySelector('[data-herdr-host]')
    return { host: host !== null, shadowRoot: host?.shadowRoot ?? null }
  })
  expect(reach).toEqual({ host: true, shadowRoot: null })

  await ui.click('.popup textarea')
  await page.keyboard.insertText('Make it green')
  await ui.click('.send-btn')

  await expect.poll(() => harness!.sentPrompts().length).toBe(1)
  expect(harness.sentPrompts()[0]?.target).toBe('w1:p2')
})

test('falls back to the clipboard notice when the native host is not installed', async () => {
  harness = await launchExtension({
    installHost: false,
    snapshot: () => liveSnapshot('idle'),
  })

  const { page } = harness

  // Trigger picker
  await triggerPick(harness.context, page)

  // Pick the save button
  await pickSaveButton(page)

  // Should show notice with no_host message
  const ui = await pickerUi(page)
  await expect.poll(() => ui.text('.agents-notice')).toContain('no_host')
})

test('content.js is a classic script', async () => {
  const contentJs = readFileSync(new URL('../dist/extension/content.js', import.meta.url), 'utf8')

  // Should not have import or export statements
  const hasModuleStatements = /^(import|export) /m.test(contentJs)
  expect(hasModuleStatements).toBe(false)

  // Should not have import.meta
  const hasImportMeta = /import\.meta/.test(contentJs)
  expect(hasImportMeta).toBe(false)
})
