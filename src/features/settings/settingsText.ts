import { LOG_MAX_BYTES, formatBytes } from '../../../electron/services/logFormat'
import type { AnimeListStatus, LogStatus } from '../../../electron/ipc/types'
/**
 * Describes the log retention row: how logs are kept and what is on disk now.
 *
 * @param status - The saved log files, or null while they load.
 * @returns The row description.
 */
export function logRetentionText(status: LogStatus | null): string
{
  const lead = `Saved one file per day, up to ${formatBytes(LOG_MAX_BYTES)} in all. Older days are deleted automatically.`
  if (!status) return lead
  if (!status.days.length) return `${lead} Nothing is saved yet.`
  const [y, m, d] = status.days[status.days.length - 1].day.split('-').map(Number)
  const since = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${lead} Kept since ${since}, ${formatBytes(status.totalBytes)} now.`
}

/**
 * Maps a Plex agent identifier to a short display label.
 *
 * @param agent - Agent id such as com.plexapp.agents.hama.
 * @returns A label like "HAMA", or an empty string.
 */
export function agentLabel(agent: string | undefined): string {
  if (!agent) return ''
  if (agent.includes('hama'))       return 'HAMA agent'
  if (agent.includes('themoviedb')) return 'TMDB agent'
  if (agent.includes('thetvdb'))    return 'TheTVDB agent'
  if (agent.includes('plex'))       return 'Plex agent'
  return agent.split('.').pop() ?? ''
}

/**
 * Pulls the Chromium build number out of a Playwright executable path, e.g.
 * ...\chromium_headless_shell-1223\... -> "1223".
 *
 * @param p - Executable path.
 * @returns The build number, or null when absent.
 */
export function chromiumBuild(p?: string): string | null {
  if (!p) return null
  const m = p.match(/chromium\w*-(\d+)/i)
  return m ? m[1] : null
}

/**
 * Describes the anime list row: what the list does, then the state of the downloaded copy.
 *
 * @param status - The list's status, or null while it loads.
 * @returns The row description.
 */
export function animeListText(status: AnimeListStatus | null): string
{
  const lead = 'Matches anime in HAMA libraries by mapping their AniDB IDs to TMDB, using the Fribb anime-lists project.'
  if (!status) return lead
  if (status.updating) return `${lead} Downloading the newest list…`
  const date = status.updatedAt
    ? new Date(status.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''
  if (status.error)
  {
    return status.downloaded
      ? `${lead} The last update failed (${status.error}), so the copy from ${date} is still in use.`
      : `${lead} The download failed (${status.error}).`
  }
  if (!status.downloaded) return `${lead} Not downloaded yet. It downloads the first time a HAMA title needs it.`
  return `${lead} Downloaded ${date}${status.titles ? `, with ${status.titles.toLocaleString()} titles` : ''}.`
}
