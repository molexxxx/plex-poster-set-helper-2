import { plexServerHeaders } from '../plexConnections'

/** A non-2xx answer from Plex Media Server, as opposed to no answer at all. */
export class PlexHttpError extends Error
{
  readonly status: number

  constructor(status: number, message: string)
  {
    super(message)
    this.status = status
  }
}

/**
 * Fetches a Plex API path, throwing on non-2xx responses.
 *
 * @param baseUrl - Server base URL.
 * @param token - Plex auth token.
 * @param path - API path beginning with a slash.
 * @param options - Extra fetch options merged over the defaults.
 * @returns Parsed JSON when possible, otherwise the raw text or an empty object.
 */
export async function plexFetch(
  baseUrl: string,
  token: string,
  path: string,
  options?: RequestInit,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      ...plexServerHeaders(token),
      ...(options?.headers as Record<string, string> ?? {}),
    },
  })
  if (!res.ok) throw new PlexHttpError(res.status, `Plex ${res.status} ${res.statusText} - ${path}`)
  const text = await res.text()
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { return text }
}

/**
 * Returns the host and port of an address for messages.
 *
 * @param url - Server address.
 * @returns The host, or the address as given when it does not parse.
 */
export function hostOf(url: string): string
{
  try
  {
    return new URL(url).host || url
  }
  catch
  {
    return url
  }
}
