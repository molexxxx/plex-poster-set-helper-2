import { describe, it, expect } from 'vitest'
import { agentLabel, animeListText, chromiumBuild, logRetentionText } from '../features/settings/settingsText'

const ANIME_LEAD = 'Matches anime in HAMA libraries by mapping their AniDB IDs to TMDB, using the Fribb anime-lists project.'

describe('agentLabel', () =>
{
  it('names the agents the libraries list shows', () =>
  {
    expect(agentLabel('com.plexapp.agents.hama')).toBe('HAMA agent')
    expect(agentLabel('tv.plex.agents.themoviedb')).toBe('TMDB agent')
    expect(agentLabel('com.plexapp.agents.thetvdb')).toBe('TheTVDB agent')
    expect(agentLabel('tv.plex.agents.movie')).toBe('Plex agent')
  })

  it('falls back to the last part of an unknown agent id', () =>
  {
    expect(agentLabel('org.example.custom')).toBe('custom')
    expect(agentLabel(undefined)).toBe('')
    expect(agentLabel('')).toBe('')
  })
})

describe('chromiumBuild', () =>
{
  it('reads the build number from a Playwright browser path', () =>
  {
    expect(chromiumBuild('C:\\ms-playwright\\chromium_headless_shell-1223\\chrome-win\\headless_shell.exe')).toBe('1223')
    expect(chromiumBuild('/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome')).toBe('1187')
  })

  it('returns null for paths without a build number', () =>
  {
    expect(chromiumBuild('/usr/bin/chromium-browser')).toBeNull()
    expect(chromiumBuild('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')).toBeNull()
    expect(chromiumBuild(undefined)).toBeNull()
  })
})

describe('logRetentionText', () =>
{
  const lead = 'Saved one file per day, up to 100 MB in all. Older days are deleted automatically.'

  it('states the policy alone until the status loads', () =>
  {
    expect(logRetentionText(null)).toBe(lead)
  })

  it('says when nothing is saved yet', () =>
  {
    expect(logRetentionText({ days: [], totalBytes: 0, retentionDays: 14, maxBytes: 1 })).toBe(`${lead} Nothing is saved yet.`)
  })

  it('reports the oldest kept day and the size on disk', () =>
  {
    const status = { days: [{ day: '2026-11-19', bytes: 20480 }, { day: '2026-11-12', bytes: 40960 }], totalBytes: 61440, retentionDays: 14, maxBytes: 1 }
    const since = new Date(2026, 10, 12).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    expect(logRetentionText(status)).toBe(`${lead} Kept since ${since}, 60 KB now.`)
  })
})

describe('animeListText', () =>
{
  const date = new Date('2026-11-10T10:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  it('describes the list alone until its status loads', () =>
  {
    expect(animeListText(null)).toBe(ANIME_LEAD)
  })

  it('reports a running download', () =>
  {
    expect(animeListText({ downloaded: true, updating: true })).toBe(`${ANIME_LEAD} Downloading the newest list…`)
  })

  it('keeps using the old copy when an update fails', () =>
  {
    expect(animeListText({ downloaded: true, updating: false, updatedAt: '2026-11-10T10:00:00Z', error: 'offline' }))
      .toBe(`${ANIME_LEAD} The last update failed (offline), so the copy from ${date} is still in use.`)
    expect(animeListText({ downloaded: false, updating: false, error: 'offline' })).toBe(`${ANIME_LEAD} The download failed (offline).`)
  })

  it('reports a missing or downloaded copy', () =>
  {
    expect(animeListText({ downloaded: false, updating: false })).toBe(`${ANIME_LEAD} Not downloaded yet. It downloads the first time a HAMA title needs it.`)
    expect(animeListText({ downloaded: true, updating: false, updatedAt: '2026-11-10T10:00:00Z', titles: 12345 }))
      .toBe(`${ANIME_LEAD} Downloaded ${date}, with ${(12345).toLocaleString()} titles.`)
    expect(animeListText({ downloaded: true, updating: false, updatedAt: '2026-11-10T10:00:00Z' })).toBe(`${ANIME_LEAD} Downloaded ${date}.`)
  })
})
