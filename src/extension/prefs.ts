import type { LastTarget, PrefStore } from './picker.ts'

/** The slice of `chrome.storage.StorageArea` the preferences use */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

function parseLast(raw: unknown): LastTarget | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { pane_id: paneId, session } = raw as Record<string, unknown>
  if (typeof paneId !== 'string') return null
  return { pane_id: paneId, session: typeof session === 'string' ? session : null }
}

/**
 * Per-site picker preferences in extension storage, keyed by the page origin:
 * out of the page's reach (unlike its localStorage) yet still per site.
 * Reads that fail resolve to the defaults and writes that fail are dropped:
 * a lost preference only costs the preselection next time.
 */
export function extensionPrefs(area: KeyValueArea, origin: string): PrefStore {
  const lastKey = `last:${origin}`
  const shotKey = `shot:${origin}`
  const write = (items: Record<string, unknown>): void => {
    area.set(items).catch(() => {})
  }

  return {
    readLast: () => area.get(lastKey).then((items) => parseLast(items[lastKey]), () => null),
    writeLast: (last) => write({ [lastKey]: { pane_id: last.pane_id, session: last.session } }),
    readShot: () => area.get(shotKey).then((items) => items[shotKey] === true, () => false),
    writeShot: (checked) => write({ [shotKey]: checked }),
  }
}
