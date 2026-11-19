import { Logger } from '../logger'
import { plexServerHeaders } from '../plexConnections'
import type { UploadReq, UploadRes, ResetReq, CurrentArtReq, CurrentArtRes, PlexArtSlot } from '../../ipc/types'
import { plexConnection } from './plexConnection'
import { plexSearch } from './plexSearch'
import { plexCollections } from './plexCollections'
import { plexFetch } from './plexHttp'
import { thumbUrl, photoSize } from './plexMetadata'

/**
 * Deletes an item's currently-selected image when it's a user upload, freeing the
 * bundle data Plex stored for it. Plex only supports deleting the active thumb/art
 * (DELETE /thumb or /art), so this must run while the uploaded image is still the
 * selected one - i.e. before any original poster is re-selected.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param itemKey - Item ratingKey.
 * @param kind - 'poster' (thumb) or 'art' (background).
 * @returns true when an uploaded image was deleted.
 */
async function deleteUploadedImage(
  baseUrl: string,
  token: string,
  itemKey: string,
  kind: 'poster' | 'art',
): Promise<boolean> {
  const listPath = kind === 'art' ? 'arts' : 'posters'
  const delPath  = kind === 'art' ? 'art'  : 'thumb'
  try {
    const data = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/${listPath}`) as {
      MediaContainer?: { Metadata?: Array<{ ratingKey?: string; provider?: string; selected?: boolean }> }
    }
    const selected = (data?.MediaContainer?.Metadata ?? []).find(p => p.selected)
    // Only delete our own uploads: Plex tags those with an upload:// ratingKey
    // (or a 'custom' provider). Never delete an agent-selected poster.
    const isUpload = !!selected && (
      (selected.ratingKey ?? '').startsWith('upload://') || selected.provider === 'custom'
    )
    if (!isUpload) return false

    await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/${delPath}`, { method: 'DELETE' })
    return true
  } catch (err) {
    Logger.warn('Plex', `Delete uploaded ${kind} failed - key ${itemKey}: ${err instanceof Error ? err.message : err}`)
    return false
  }
}

/**
 * Polls Plex's /activities feed for a background task matching `match`, resolving
 * once it has appeared and then cleared. Lets callers track real task completion
 * instead of guessing with a fixed timer. Tolerant of tasks that finish too fast
 * to ever surface (resolves after a short grace window) and bounded by a hard cap
 * so it can never hang.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param match - Tested against each activity's "type title subtitle".
 * @param opts - Poll interval, grace window before assuming a no-show finished, and max wait (ms).
 */
async function waitForActivity(
  baseUrl: string,
  token: string,
  match: RegExp,
  { pollMs = 1000, graceMs = 4000, maxMs = 180_000 }: { pollMs?: number; graceMs?: number; maxMs?: number } = {},
): Promise<void> {
  const start = Date.now()
  let seen = false
  for (;;) {
    let active = false
    try {
      const data = await plexFetch(baseUrl, token, '/activities') as {
        MediaContainer?: { Activity?: Array<{ type?: string; title?: string; subtitle?: string }> }
      }
      active = (data?.MediaContainer?.Activity ?? []).some(a =>
        match.test(`${a.type ?? ''} ${a.title ?? ''} ${a.subtitle ?? ''}`))
    } catch {
      // /activities unavailable on this server - fall back to the grace window
    }
    const elapsed = Date.now() - start
    if (active) seen = true
    else if (seen) return            // it ran and has now cleared
    else if (elapsed >= graceMs) return  // never surfaced - assume it finished quickly
    if (elapsed >= maxMs) return         // safety cap
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/** Artwork on Plex items: what is set now, uploads and resets, bundle cleanup, stats, and the photo proxy. */
export const plexArtwork = {
  /**
   * Returns current Plex poster thumbs for a library item and its related
   * hierarchy (collection members, seasons, etc.).
   */
  async getCurrentArt(req: CurrentArtReq): Promise<CurrentArtRes> {
    const conn = plexConnection.getConnection()
    if (!conn) return { slots: [] }
    const { baseUrl, token } = conn
    const slots: PlexArtSlot[] = []

    const movieLabel = (title: string, year?: number) =>
      year ? `${title} (${year})` : title

    if (req.type === 'collection') {
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/metadata/${req.key}?includeGuids=1`,
        ) as {
          MediaContainer?: { Metadata?: Array<{ title?: string; thumb?: string }> }
        }
        const meta = data?.MediaContainer?.Metadata?.[0]
        const title = meta?.title ?? req.title
        slots.push({
          key: req.key,
          label: title,
          thumb: thumbUrl(baseUrl, token, meta?.thumb as string | undefined),
          kind: 'collection',
          highlight: true,
        })
      } catch {
        slots.push({ key: req.key, label: req.title, kind: 'collection', highlight: true })
      }
      for (const child of await plexCollections.getCollectionChildren(req.key)) {
        slots.push({
          key: child.key,
          label: movieLabel(child.title, child.year),
          thumb: child.thumb,
          kind: 'movie',
        })
      }
      return { slots }
    }

    if (req.type === 'movie') {
      let collectionTags: string[] = []
      let librarySectionId: string | undefined
      try {
        const data = await plexFetch(
          baseUrl, token,
          `/library/metadata/${req.key}?includeGuids=1`,
        ) as {
          MediaContainer?: { Metadata?: Array<{
            title?: string; year?: number; thumb?: string
            librarySectionID?: string | number
            Collection?: Array<{ tag?: string }>
          }> }
        }
        const meta = data?.MediaContainer?.Metadata?.[0]
        const title = meta?.title ?? req.title
        const year = meta?.year ?? req.year
        librarySectionId = meta?.librarySectionID != null ? String(meta.librarySectionID) : undefined
        // Use the movie's real collection membership as reported by Plex (its
        // Collection tags), rather than guessing a collection from the movie
        // title - the old title guess fuzzy-matched unrelated collections
        // (e.g. "8 Mile" -> "One Mile Collection").
        collectionTags = Array.from(new Set(
          (Array.isArray(meta?.Collection) ? meta!.Collection : [])
            .map(c => c?.tag?.trim())
            .filter((t): t is string => !!t),
        ))
        slots.push({
          key: req.key,
          label: movieLabel(title, year),
          thumb: thumbUrl(baseUrl, token, meta?.thumb as string | undefined),
          kind: 'movie',
          highlight: true,
        })
      } catch {
        slots.push({
          key: req.key,
          label: movieLabel(req.title, req.year),
          kind: 'movie',
          highlight: true,
        })
      }

      // Only surface genuine franchise collections (Toy Story, Harry Potter) and
      // their sibling movies. Smart/rule-based or oversized collections - e.g. the
      // Kometa-managed "Trending Movies", "All Ages", "Metacritic Must See" - are
      // organisational buckets, not artwork families, so they're skipped entirely
      // (neither the collection nor its members belong in this item's art strip).
      const MEMBER_EXPAND_CAP = 30
      for (const tag of collectionTags) {
        const coll = await plexSearch.resolveCollectionByName(tag, librarySectionId)
        if (!coll) continue
        if (coll.smart || (coll.childCount != null && coll.childCount > MEMBER_EXPAND_CAP)) continue
        const children = await plexCollections.getCollectionChildren(coll.key)
        if (children.length > MEMBER_EXPAND_CAP) continue
        slots.push({
          key: coll.key,
          label: coll.title,
          thumb: thumbUrl(baseUrl, token, coll.thumb),
          kind: 'collection',
        })
        for (const child of children) {
          if (child.key === req.key) continue
          slots.push({
            key: child.key,
            label: movieLabel(child.title, child.year),
            thumb: child.thumb,
            kind: 'movie',
          })
        }
      }
      return { slots }
    }

    // show
    try {
      const data = await plexFetch(
        baseUrl, token,
        `/library/metadata/${req.key}?includeGuids=1`,
      ) as {
        MediaContainer?: { Metadata?: Array<{ title?: string; thumb?: string }> }
      }
      const meta = data?.MediaContainer?.Metadata?.[0]
      slots.push({
        key: req.key,
        label: meta?.title ?? req.title,
        thumb: thumbUrl(baseUrl, token, meta?.thumb as string | undefined),
        kind: 'show',
        highlight: true,
      })
    } catch {
      slots.push({ key: req.key, label: req.title, kind: 'show', highlight: true })
    }

    try {
      const seasonData = await plexFetch(baseUrl, token, `/library/metadata/${req.key}/children`) as {
        MediaContainer?: { Metadata?: Array<{ ratingKey: string; index?: number; thumb?: string }> }
      }
      const seasons = (seasonData?.MediaContainer?.Metadata ?? [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      for (const s of seasons) {
        const idx = s.index ?? 0
        slots.push({
          key: s.ratingKey,
          label: idx === 0 ? 'Specials' : `Season ${idx}`,
          thumb: thumbUrl(baseUrl, token, s.thumb),
          kind: 'season',
          season: idx,
        })
      }
    } catch {
      // seasons unavailable
    }

    return { slots }
  },

  /**
   * Resolves the real upload target for a poster. Given the show's ratingKey
   * plus optional season/episode hints, walks the Plex hierarchy to find the
   * ratingKey the poster should actually apply to, and whether it's a poster
   * or a background ("art", for backdrops).
   *
   * @param showKey - The show or movie ratingKey.
   * @param season - Season number, or Cover / Backdrop markers.
   * @param episode - Episode number within the season.
   * @returns The target key and kind, or a skip result when the season/episode
   *   doesn't exist in this library.
   */
  async resolveTarget(
    showKey: string,
    season?: number | 'Cover' | 'Backdrop',
    episode?: number,
  ): Promise<{ key: string; kind: 'poster' | 'art' } | { kind: 'skip'; reason: string }> {
    const conn = plexConnection.getConnection()
    if (!conn) return { key: showKey, kind: 'poster' }
    const { baseUrl, token } = conn

    if (season === 'Backdrop') return { key: showKey, kind: 'art' }
    if (season == null || season === 'Cover') return { key: showKey, kind: 'poster' }

    try {
      const seasonData = await plexFetch(baseUrl, token, `/library/metadata/${showKey}/children`) as {
        MediaContainer?: { Metadata?: Array<{ ratingKey: string; index?: number }> }
      }
      const seasons = seasonData?.MediaContainer?.Metadata ?? []
      const seasonNode = seasons.find(s => s.index === season)
      // Skip rather than clobbering the show poster with a season poster /
      // title card the user can't actually use
      if (!seasonNode) {
        Logger.warn('Plex', `Season ${season} not found under show ${showKey} - skipping`)
        return { kind: 'skip', reason: `Season ${season} not in library` }
      }

      if (episode == null) return { key: seasonNode.ratingKey, kind: 'poster' }

      const epData = await plexFetch(baseUrl, token, `/library/metadata/${seasonNode.ratingKey}/children`) as {
        MediaContainer?: { Metadata?: Array<{ ratingKey: string; index?: number }> }
      }
      const episodes = epData?.MediaContainer?.Metadata ?? []
      const epNode = episodes.find(e => e.index === episode)
      // Skip rather than overwriting the season poster with this episode's
      // title card (the cause of "all cards on the season poster" when a set
      // has more episodes than Plex has)
      if (!epNode) {
        Logger.warn('Plex', `S${season}E${episode} not found - skipping`)
        return { kind: 'skip', reason: `S${season}E${episode} not in library` }
      }
      return { key: epNode.ratingKey, kind: 'poster' }
    } catch (err) {
      Logger.warn('Plex', `Target resolution failed for show ${showKey}: ${err instanceof Error ? err.message : err}`)
      return { key: showKey, kind: 'poster' }
    }
  },

  /**
   * Downloads a poster image and uploads it to the resolved target (show,
   * season, episode, or background art), tagging the item with its source label.
   *
   * @param req - Item key, image URL, source site, and season/episode hints.
   * @returns Success flag, with an error message on failure or skip.
   */
  async uploadPoster(req: UploadReq): Promise<UploadRes> {
    const conn = plexConnection.getConnection()
    if (!conn) return { success: false, error: 'Not connected to Plex' }
    const { baseUrl, token } = conn
    const { itemKey, imageUrl, source, season, episode, isCollection, title } = req
    const labelTag = source === 'mediux' ? 'MediUX' : 'ThePosterDB'
    const named = title ? `"${title}"` : `item ${itemKey}`

    try {
      let target: { key: string; kind: 'poster' | 'art' }
      if (isCollection) {
        // Collections have child movies; never walk /children or art lands on a member.
        target = season === 'Backdrop' ? { key: itemKey, kind: 'art' } : { key: itemKey, kind: 'poster' }
      } else {
        const resolved = await plexArtwork.resolveTarget(itemKey, season, episode)
        if (resolved.kind === 'skip') {
          Logger.scrape('Plex', `Skipped upload to ${named} - ${resolved.reason}`)
          return { success: false, error: resolved.reason, skipped: true }
        }
        target = resolved
      }
      const endpoint = target.kind === 'art' ? 'arts' : 'posters'

      const imgRes = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`)
      const imgBuf = Buffer.from(await imgRes.arrayBuffer())
      const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg'

      await plexFetch(baseUrl, token, `/library/metadata/${target.key}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: imgBuf,
      })

      // Tag the show (itemKey) with the source label for later reset/stats
      await plexFetch(
        baseUrl, token,
        `/library/metadata/${itemKey}?label[].tag.tag=${encodeURIComponent(labelTag)}&label.locked=1`,
        { method: 'PUT' },
      )

      const where = isCollection
        ? 'collection'
        : target.key === itemKey
          ? 'title' : `S${season ?? '?'}${episode != null ? `E${episode}` : ''}`
      const art = target.kind === 'art' ? 'Backdrop' : 'Poster'
      Logger.success('Plex', `${art} applied to ${named} (${where}) from ${labelTag}`, { key: target.key })
      return { success: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      Logger.error('Plex', `Upload to ${named} failed: ${error}`, { key: itemKey })
      return { success: false, error }
    }
  },

  /**
   * Restores an item's original provider poster, removes source labels, and
   * optionally recurses into children (seasons and episodes).
   *
   * @param req - Item key and whether to reset hierarchically.
   */
  async resetPoster(req: ResetReq): Promise<void> {
    const conn = plexConnection.getConnection()
    if (!conn) throw new Error('Not connected to Plex')
    const { baseUrl, token } = conn
    const { itemKey, hierarchical, deleteUploads } = req

    // Free the uploaded image data first: Plex can only delete the *active* thumb/art,
    // so this must happen before the original poster is re-selected below. Deletion
    // also reverts Plex to a default, making the select-original step a clean fallback.
    if (deleteUploads) {
      await deleteUploadedImage(baseUrl, token, itemKey, 'poster')
      await deleteUploadedImage(baseUrl, token, itemKey, 'art')
    }

    const postersData = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/posters`) as {
      MediaContainer?: { Metadata?: Array<{ ratingKey?: string; thumb?: string; selected?: boolean; provider?: string }> }
    }
    const posters = postersData?.MediaContainer?.Metadata ?? []

    // Any poster that isn't from the custom upload provider
    const original = posters.find(p => {
      const src = p.provider ?? ''
      return src !== 'custom' && src !== ''
    }) ?? posters.find(p => !p.selected)

    if (original) {
      const posterKey = original.ratingKey ?? original.thumb ?? ''
      if (posterKey) {
        await plexFetch(
          baseUrl, token,
          `/library/metadata/${itemKey}/poster?url=${encodeURIComponent(posterKey)}`,
          { method: 'PUT' },
        )
      }
    }

    for (const label of ['MediUX', 'ThePosterDB']) {
      try {
        await plexFetch(
          baseUrl, token,
          `/library/metadata/${itemKey}?label[].tag.tag=${encodeURIComponent(label)}&label[].tag.locked=0`,
          { method: 'PUT' },
        )
      } catch {
        // label may not exist on this item
      }
    }

    if (hierarchical) {
      try {
        const childData = await plexFetch(baseUrl, token, `/library/metadata/${itemKey}/children`) as {
          MediaContainer?: { Metadata?: Array<{ ratingKey: string }> }
        }
        for (const child of childData?.MediaContainer?.Metadata ?? []) {
          await plexArtwork.resetPoster({ itemKey: child.ratingKey, hierarchical: true, deleteUploads })
        }
      } catch {
        // no children or server error - skip
      }
    }

    Logger.info('Plex', `Poster reset - key ${itemKey}`)
  },

  /**
   * Triggers Plex's "Clean Bundles" maintenance task to reclaim disk space from
   * deleted/unused poster and art bundles, then waits for it to actually finish
   * (the task runs asynchronously server-side) so the UI reflects real completion
   * rather than a guessed cooldown.
   */
  async cleanBundles(): Promise<void> {
    const conn = plexConnection.getConnection()
    if (!conn) throw new Error('Not connected to Plex')
    const { baseUrl, token } = conn
    // 200 = started, 202 = already running; both are ok and we then wait it out.
    await plexFetch(baseUrl, token, '/butler/CleanOldBundles', { method: 'POST' })
    Logger.info('Plex', 'Triggered Clean Bundles task')
    await waitForActivity(baseUrl, token, /bundle/i)
    Logger.info('Plex', 'Clean Bundles finished')
  },

  /**
   * Counts labeled items per source and media type for the dashboard.
   *
   * @returns Counts keyed by mediux, posterdb, total, movies, and shows.
   */
  async getStats(): Promise<Record<string, number>> {
    const [mediuxItems, posterdbItems] = await Promise.all([
      plexSearch.getLabeledItems({ label: 'MediUX' }),
      plexSearch.getLabeledItems({ label: 'ThePosterDB' }),
    ])
    const all = [...mediuxItems, ...posterdbItems]
    return {
      mediux:   mediuxItems.length,
      posterdb: posterdbItems.length,
      total:    all.length,
      movies:   all.filter(i => i.type === 'movie').length,
      shows:    all.filter(i => i.type === 'show').length,
    }
  },

  /**
   * Fetches a resized Plex image for the web UI, which loads images through
   * this app rather than from the server address directly.
   *
   * @param path - Server-relative image path, such as /library/metadata/1/thumb/2.
   * @param width - Output width in pixels.
   * @param height - Output height in pixels.
   * @returns The image and its type, or the HTTP status to answer with.
   */
  async fetchPhoto(path: string, width: number, height: number): Promise<{ status: number; contentType?: string; body?: Buffer }>
  {
    const conn = plexConnection.getConnection()
    if (!conn) return { status: 503 }
    if (!path.startsWith('/') || path.startsWith('//')) return { status: 400 }
    const { baseUrl, token } = conn
    const url = `${baseUrl.replace(/\/$/, '')}/photo/:/transcode?width=${photoSize(width, 240)}&height=${photoSize(height, 360)}&minSize=1&upscale=1&url=${encodeURIComponent(path)}`
    try
    {
      const res = await fetch(url, {
        headers: { ...plexServerHeaders(token), Accept: 'image/*' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) return { status: res.status === 404 ? 404 : 502 }
      return {
        status: 200,
        contentType: res.headers.get('content-type') ?? 'image/jpeg',
        body: Buffer.from(await res.arrayBuffer()),
      }
    }
    catch
    {
      return { status: 502 }
    }
  },
}
