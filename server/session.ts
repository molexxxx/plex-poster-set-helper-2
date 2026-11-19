import { createHash, randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import { getUserDataPath } from '../electron/runtime/paths'
import { Logger } from '../electron/services/logger'

export const SESSION_COOKIE = 'ppsh_session'
export const SIGN_IN_COOKIE = 'ppsh_signin'
/** A session ends after this long without a request. */
const IDLE_TTL_MS = 30 * 24 * 60 * 60_000
/** Last-seen times reach disk at most this often per session. */
const TOUCH_INTERVAL_MS = 60 * 60_000
const MAX_SESSIONS = 200
const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365

interface StoredSession
{
  created: number
  seen: number
}

let _sessions: Map<string, StoredSession> | null = null

/**
 * Returns where sessions are kept: the config volume, so they survive restarts.
 *
 * @returns Path of sessions.json.
 */
function storePath(): string
{
  return path.join(getUserDataPath(), 'sessions.json')
}

/**
 * Hashes a session id. Only hashes are stored, so the file cannot be replayed as cookies.
 *
 * @param id - Session id from a cookie.
 * @returns Hex SHA-256 of the id.
 */
function hashId(id: string): string
{
  return createHash('sha256').update(id).digest('hex')
}

/**
 * Loads the session store on first use, dropping expired entries.
 *
 * @returns The live sessions keyed by id hash.
 */
function store(): Map<string, StoredSession>
{
  if (_sessions) return _sessions
  _sessions = new Map()
  try
  {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Record<string, StoredSession>
    const now = Date.now()
    for (const [key, entry] of Object.entries(raw))
    {
      if (entry && typeof entry.seen === 'number' && now - entry.seen < IDLE_TTL_MS) _sessions.set(key, entry)
    }
  }
  catch
  {
    // No file yet, or an unreadable one: start with no sessions.
  }
  return _sessions
}

/** Writes the session store, replacing the file atomically. */
function save(): void
{
  const file = storePath()
  const temp = `${file}.tmp`
  try
  {
    fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(store())), { mode: 0o600 })
    fs.renameSync(temp, file)
  }
  catch (err)
  {
    Logger.warn('Server', `Could not save web sessions: ${err instanceof Error ? err.message : err}`)
  }
}

/** Web UI sessions: one per signed-in browser, kept on disk as hashes. */
export const Sessions = {
  /**
   * Starts a session for a browser that proved it belongs to the owner.
   *
   * @returns The new session id for the cookie.
   */
  create(): string
  {
    const sessions = store()
    const now = Date.now()
    for (const [key, entry] of sessions)
    {
      if (now - entry.seen >= IDLE_TTL_MS) sessions.delete(key)
    }
    while (sessions.size >= MAX_SESSIONS)
    {
      const oldest = [...sessions.entries()].reduce((a, b) => (a[1].seen <= b[1].seen ? a : b))
      sessions.delete(oldest[0])
    }
    const id = randomBytes(32).toString('base64url')
    sessions.set(hashId(id), { created: now, seen: now })
    save()
    return id
  },

  /**
   * Tests a session id and records that the browser is still active.
   *
   * @param id - Session id from the cookie, if any.
   * @returns true while the session exists and has not idled out.
   */
  isValid(id: string | undefined): boolean
  {
    if (!id) return false
    const sessions = store()
    const key = hashId(id)
    const entry = sessions.get(key)
    if (!entry) return false
    const now = Date.now()
    if (now - entry.seen >= IDLE_TTL_MS)
    {
      sessions.delete(key)
      save()
      return false
    }
    if (now - entry.seen >= TOUCH_INTERVAL_MS)
    {
      entry.seen = now
      save()
    }
    return true
  },

  /**
   * Ends one browser's session.
   *
   * @param id - Session id from the cookie, if any.
   */
  destroy(id: string | undefined): void
  {
    if (!id) return
    if (store().delete(hashId(id))) save()
  },

  /** Ends every session, for when the Plex account is unlinked. */
  destroyAll(): void
  {
    store().clear()
    save()
  },

  /** Forgets the in-memory copy so the next call reads the file again, as after a restart. */
  reload(): void
  {
    _sessions = null
  },
}

/**
 * Reads one cookie from a Cookie header.
 *
 * @param header - The request's Cookie header.
 * @param name - Cookie name.
 * @returns The cookie's value, or undefined.
 */
export function readCookie(header: string | undefined, name: string): string | undefined
{
  if (!header) return undefined
  for (const part of header.split(';'))
  {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

/**
 * Builds a Set-Cookie value for a browser-only cookie.
 *
 * @param name - Cookie name.
 * @param value - Cookie value, or '' to clear it.
 * @param secure - Add Secure, for pages served over HTTPS.
 * @param maxAgeSec - Lifetime in seconds; 0 clears the cookie.
 * @returns The header value.
 */
export function cookieHeader(name: string, value: string, secure: boolean, maxAgeSec: number): string
{
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`
}

/**
 * Builds the session cookie.
 *
 * @param id - Session id from Sessions.create().
 * @param secure - Add Secure, for pages served over HTTPS.
 * @returns The Set-Cookie value.
 */
export function sessionCookie(id: string, secure: boolean): string
{
  return cookieHeader(SESSION_COOKIE, id, secure, SESSION_COOKIE_MAX_AGE_SEC)
}
