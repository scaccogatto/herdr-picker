import { describe, it, expect } from 'vitest'
import type { KeyValueArea } from '../extension/prefs.ts'
import { extensionPrefs } from '../extension/prefs.ts'

function memoryArea(): KeyValueArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => {
      Object.assign(data, items)
    },
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('extensionPrefs', () => {
  it('returns the defaults when nothing is stored', async () => {
    const prefs = extensionPrefs(memoryArea(), 'https://a.test')
    expect(await prefs.readLast()).toBeNull()
    expect(await prefs.readShot()).toBe(false)
  })

  it('round-trips the last target and the screenshot switch', async () => {
    const prefs = extensionPrefs(memoryArea(), 'https://a.test')
    prefs.writeLast({ pane_id: 'w1:p2', session: 's1' })
    prefs.writeShot(true)
    await flush()
    expect(await prefs.readLast()).toEqual({ pane_id: 'w1:p2', session: 's1' })
    expect(await prefs.readShot()).toBe(true)
  })

  it('keeps each origin separate', async () => {
    const area = memoryArea()
    extensionPrefs(area, 'https://a.test').writeLast({ pane_id: 'w1:p2', session: null })
    extensionPrefs(area, 'https://a.test').writeShot(true)
    await flush()
    const other = extensionPrefs(area, 'https://b.test')
    expect(await other.readLast()).toBeNull()
    expect(await other.readShot()).toBe(false)
    expect(Object.keys(area.data).sort()).toEqual(['last:https://a.test', 'shot:https://a.test'])
  })

  it('rejects a malformed stored target', async () => {
    const area = memoryArea()
    area.data['last:https://a.test'] = { pane_id: 42 }
    expect(await extensionPrefs(area, 'https://a.test').readLast()).toBeNull()
    area.data['last:https://a.test'] = { pane_id: 'w1:p2', session: 7 }
    expect(await extensionPrefs(area, 'https://a.test').readLast()).toEqual({ pane_id: 'w1:p2', session: null })
  })

  it('treats a non-boolean stored switch as off', async () => {
    const area = memoryArea()
    area.data['shot:https://a.test'] = '1'
    expect(await extensionPrefs(area, 'https://a.test').readShot()).toBe(false)
  })

  it('falls back to the defaults when storage fails', async () => {
    const area: KeyValueArea = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
    }
    const prefs = extensionPrefs(area, 'https://a.test')
    expect(await prefs.readLast()).toBeNull()
    expect(await prefs.readShot()).toBe(false)
    expect(() => prefs.writeShot(true)).not.toThrow()
    await flush()
  })
})
