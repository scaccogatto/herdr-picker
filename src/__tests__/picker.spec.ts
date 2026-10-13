// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import type { StateResponse, PromptResponse, SpawnResponse } from '../types.ts'
import type { LastTarget, PrefStore, Relay, RelayReply } from '../extension/picker.ts'
import { mount } from '../extension/picker.ts'

const fakeRelay = (): { relay: Relay; calls: Record<string, number | unknown[]> } => {
  const calls = { state: 0, prompt: [] as unknown[], spawn: 0, capture: 0 }
  const relay: Relay = {
    state: async () => {
      calls.state++
      return {
        herdr: true,
        version: '0.8.2',
        protocol: 20,
        workspaceId: 'w1',
        paneId: 'w1:p1',
        workspaces: [{ workspace_id: 'w1', label: 'app', number: 1, focused: true }],
        agents: [
          { pane_id: 'w1:p2', workspace_id: 'w1', agent_status: 'idle', agent: 'claude', title: 'Settings polish', branch: 'main', session: 's1', focused: false, cwd: null },
          { pane_id: 'w1:p3', workspace_id: 'w1', agent_status: 'working', agent: 'claude', title: 'Long task', branch: 'main', session: 's2', focused: false, cwd: null },
        ],
        screenshot: 'available',
      } as StateResponse
    },
    prompt: async (body: unknown) => {
      calls.prompt.push(body)
      const { target } = body as { target: string }
      return { status: 200, body: { ok: true, target, title: 'Settings polish', pane_id: target, screenshot: null } } as RelayReply<PromptResponse>
    },
    spawn: async () => {
      calls.spawn++
      return { status: 200, body: { ok: true, pane_id: 'w1:p9', name: 'pick-1', workspace_id: 'w1' } } as RelayReply<SpawnResponse>
    },
    capture: async () => {
      calls.capture++
      return 'iVBORw0KGgo='
    },
  }
  return { relay, calls }
}

/** In-memory PrefStore that records writes */
const memoryPrefs = (init: { last?: LastTarget | null; shot?: boolean } = {}): PrefStore & { lastWrites: LastTarget[]; shotWrites: boolean[] } => {
  const lastWrites: LastTarget[] = []
  const shotWrites: boolean[] = []
  return {
    lastWrites,
    shotWrites,
    readLast: async () => init.last ?? null,
    writeLast: (last) => { lastWrites.push(last) },
    readShot: async () => init.shot ?? false,
    writeShot: (checked) => { shotWrites.push(checked) },
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  document.body.innerHTML = ''
  document.querySelector('[data-herdr-host]')?.remove()
  delete window.__herdr
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  if (!Element.prototype.animate) {
    (Element.prototype as any).animate = () => ({ cancel: () => {} })
  }
  const btn = document.createElement('button')
  btn.id = 'target'
  btn.textContent = 'Save'
  document.body.appendChild(btn)
})

describe('picker.mount', () => {
  it('appends [data-herdr-host], returns its shadow root and defines window.__herdr', () => {
    const { relay } = fakeRelay()
    const shadow = mount(relay, memoryPrefs())
    expect(document.querySelector('[data-herdr-host]')).not.toBeNull()
    expect(shadow.querySelector('.popup')).not.toBeNull()
    expect(window.__herdr?.start).toBeDefined()
    expect(window.__herdr?.pick).toBeDefined()
    expect(window.__herdr?.close).toBeDefined()
  })

  it('start() toggles cursor, inflight() is null', () => {
    const { relay } = fakeRelay()
    mount(relay, memoryPrefs())
    expect(document.documentElement.style.cursor).toBe('')
    window.__herdr!.start()
    expect(document.documentElement.style.cursor).toBe('crosshair')
    window.__herdr!.start()
    expect(document.documentElement.style.cursor).toBe('')
    expect(window.__herdr!.inflight()).toBeNull()
  })

  it('pick() shows popup, calls relay.state() once, renders agents and spawn rows', async () => {
    const { relay, calls } = fakeRelay()
    const shadow = mount(relay, memoryPrefs())
    window.__herdr!.pick(document.querySelector('#target')!, 10, 10)
    const popup = shadow.querySelector('.popup') as HTMLElement
    expect(popup?.style.display).toBe('flex')
    expect(calls.state).toBe(1)
    await new Promise((r) => setTimeout(r, 0))
    const options = shadow.querySelectorAll('[role="option"]')
    expect(options!.length).toBeGreaterThan(0)
    const idle = shadow.querySelector('[data-pane-id="w1:p2"]')
    expect(idle?.getAttribute('aria-selected')).toBe('true')
    expect(shadow.querySelectorAll('.spawn-row').length).toBe(2)
  })

  it('untrusted click on send button does not call relay.prompt', async () => {
    const { relay, calls } = fakeRelay()
    const shadow = mount(relay, memoryPrefs())
    window.__herdr!.pick(document.querySelector('#target')!, 10, 10)
    await new Promise((r) => setTimeout(r, 0))
    const textarea = shadow.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'test'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    shadow.querySelector('.send-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect((calls.prompt as unknown[]).length).toBe(0)
  })

  it('untrusted Enter key does not call relay.prompt', async () => {
    const { relay, calls } = fakeRelay()
    const shadow = mount(relay, memoryPrefs())
    window.__herdr!.pick(document.querySelector('#target')!, 10, 10)
    await new Promise((r) => setTimeout(r, 0))
    const textarea = shadow.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'test'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect((calls.prompt as unknown[]).length).toBe(0)
  })

  it('untrusted input event does not update typed prompt', async () => {
    const { relay, calls } = fakeRelay()
    const shadow = mount(relay, memoryPrefs())
    window.__herdr!.pick(document.querySelector('#target')!, 10, 10)
    await new Promise((r) => setTimeout(r, 0))
    const textarea = shadow.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'evil'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    shadow.querySelector('.send-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect((calls.prompt as unknown[]).length).toBe(0)
  })

  it('close() hides popup and selection() is empty', async () => {
    const { relay } = fakeRelay()
    const shadow = mount(relay, memoryPrefs())
    window.__herdr!.pick(document.querySelector('#target')!, 10, 10)
    await new Promise((r) => setTimeout(r, 0))
    const popup = shadow.querySelector('.popup') as HTMLElement
    window.__herdr!.close()
    expect(popup?.style.display).toBe('none')
    expect(window.__herdr!.selection()).toEqual([])
  })

  it('describe() returns ElementInfo with button#target in path', () => {
    const { relay } = fakeRelay()
    mount(relay, memoryPrefs())
    const info = window.__herdr!.describe(document.querySelector('#target')!)
    expect(info.path).toContain('button#target')
    expect(info.html).toContain('data-herdr-picked')
    expect(info.url).toBeDefined()
    expect(info.viewport).toBeDefined()
    expect(info.rect).toBeDefined()
  })
})

describe('picker against a hostile page', () => {
  const pickTarget = async (prefs = memoryPrefs()): Promise<ShadowRoot> => {
    const { relay } = fakeRelay()
    const shadow = mount(relay, prefs)
    window.__herdr!.pick(document.querySelector('#target')!, 10, 10)
    await tick()
    return shadow
  }

  const selected = (shadow: ShadowRoot): string | undefined =>
    shadow.querySelector<HTMLElement>('.agent-row[aria-selected="true"]')?.dataset.paneId

  it('mounts a closed shadow root the page cannot read', () => {
    const { relay } = fakeRelay()
    mount(relay, memoryPrefs())
    expect(document.querySelector('[data-herdr-host]')?.shadowRoot).toBeNull()
  })

  it('ignores an untrusted click on an agent row', async () => {
    const shadow = await pickTarget()
    expect(selected(shadow)).toBe('w1:p2')
    shadow.querySelector('[data-pane-id="w1:p3"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(selected(shadow)).toBe('w1:p2')
  })

  it('ignores an untrusted click on a spawn row', async () => {
    const shadow = await pickTarget()
    shadow.querySelector('[data-pane-id="spawn:worktree"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(selected(shadow)).toBe('w1:p2')
  })

  it('ignores an untrusted click on the To row', async () => {
    const shadow = await pickTarget()
    const toRow = shadow.querySelector('.to-row') as HTMLElement
    expect(toRow.getAttribute('aria-expanded')).toBe('false')
    toRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(toRow.getAttribute('aria-expanded')).toBe('false')
  })

  it('ignores an untrusted click on the screenshot switch', async () => {
    const prefs = memoryPrefs()
    const shadow = await pickTarget(prefs)
    const checkbox = shadow.querySelector('.shot-row input[type=checkbox]') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    checkbox.click()
    expect(checkbox.checked).toBe(false)
    expect(window.__herdr!.screenshotEnabled()).toBe(false)
    expect(prefs.shotWrites).toEqual([])
  })

  it('preselects the last target from the pref store, not the page localStorage', async () => {
    localStorage.setItem('herdr:last', JSON.stringify({ pane_id: 'w1:p3', session: 's2' }))
    try {
      expect(selected(await pickTarget())).toBe('w1:p2')
    } finally {
      localStorage.removeItem('herdr:last')
    }
  })

  it('preselects the stored last target', async () => {
    const shadow = await pickTarget(memoryPrefs({ last: { pane_id: 'w1:p3', session: 's2' } }))
    expect(selected(shadow)).toBe('w1:p3')
  })

  it('restores the screenshot switch from the pref store', async () => {
    const { relay } = fakeRelay()
    mount(relay, memoryPrefs({ shot: true }))
    await tick()
    expect(window.__herdr!.screenshotEnabled()).toBe(true)
  })

  it('falls back to no preselection memory when the pref store fails', async () => {
    const prefs = memoryPrefs()
    prefs.readLast = () => Promise.reject(new Error('storage down'))
    expect(selected(await pickTarget(prefs))).toBe('w1:p2')
  })
})
