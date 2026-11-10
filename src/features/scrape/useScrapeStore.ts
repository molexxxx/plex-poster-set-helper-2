import { create } from 'zustand'
import type { ArtworkType, PosterInfo } from '../../../electron/ipc/types'
import { uuid } from '../../utils/uuid'

export type EntryStatus = 'idle' | 'scraping' | 'done' | 'error'
export type UploadStatus = 'idle' | 'matching' | 'uploading' | 'done' | 'error' | 'no_match'

export interface PosterResult extends PosterInfo {
  uploadStatus: UploadStatus
  uploadError?: string
}

export interface QueueEntry {
  id: string
  url: string
  status: EntryStatus
  posters: PosterResult[]
  error?: string
  workerId?: number
}

interface ScrapeStore {
  entries: QueueEntry[]
  isRunning: boolean
  /** Artwork types shown and uploaded; null until read from Settings. */
  types: ArtworkType[] | null

  addUrls:     (urls: string[]) => void
  removeEntry: (id: string) => void
  /** Wholesale replacement, used by Reorder.onReorder. */
  setEntries:  (entries: QueueEntry[]) => void
  patchEntry:  (id: string, patch: Partial<QueueEntry>) => void
  patchPoster: (entryId: string, posterUrl: string, patch: Partial<PosterResult>) => void
  clearAll:    () => void

  setRunning: (v: boolean) => void
  setTypes:   (types: ArtworkType[]) => void
}

const SUPPORTED = /theposterdb\.com|mediux\.pro/i

/**
 * Trims whitespace and a trailing slash.
 *
 * @param raw - URL as typed or pasted.
 * @returns The normalised URL.
 */
function normaliseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, '')
}

/**
 * Checks whether a URL belongs to a supported source site.
 *
 * @param url - URL to test.
 * @returns true for theposterdb.com and mediux.pro hosts.
 */
function isSupported(url: string): boolean {
  try {
    return SUPPORTED.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Zustand store for the scrape queue and its run state. */
export const useScrapeStore = create<ScrapeStore>((set, get) => ({
  entries: [],
  isRunning: false,
  types: null,

  addUrls(rawUrls) {
    const existing = new Set(get().entries.map(e => e.url))
    const toAdd: QueueEntry[] = rawUrls
      .map(normaliseUrl)
      .filter(url => url.length > 0 && isSupported(url) && !existing.has(url))
      .map(url => ({
        id: uuid(),
        url,
        status: 'idle' as EntryStatus,
        posters: [],
      }))
    if (toAdd.length) set(s => ({ entries: [...s.entries, ...toAdd] }))
  },

  removeEntry(id) {
    set(s => ({ entries: s.entries.filter(e => e.id !== id) }))
  },

  setEntries(entries) {
    set({ entries })
  },

  patchEntry(id, patch) {
    set(s => ({
      entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e),
    }))
  },

  patchPoster(entryId, posterUrl, patch) {
    set(s => ({
      entries: s.entries.map(e => {
        if (e.id !== entryId) return e
        return {
          ...e,
          posters: e.posters.map(p => p.url === posterUrl ? { ...p, ...patch } : p),
        }
      }),
    }))
  },

  clearAll() {
    set({ entries: [], isRunning: false })
  },

  setRunning(v) {
    set({ isRunning: v })
  },

  setTypes(types) {
    set({ types })
  },
}))
