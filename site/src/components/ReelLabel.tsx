import { useEffect, useState } from 'react'
import { release, megabytes, isoDay, RELEASES_URL, UNRAID_URL } from '../data/release'
import { links } from '../lib/site'

export type Platform = 'windows' | 'linux' | 'docker' | 'unraid'

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
  { id: 'docker', label: 'Docker' },
  { id: 'unraid', label: 'Unraid' },
]

/**
 * Guesses the visitor's platform from the browser.
 *
 * @returns The platform to preselect and whether the visitor is on a Mac.
 */
function detect(): { platform: Platform; mac: boolean }
{
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const os = nav.userAgentData?.platform || navigator.platform || navigator.userAgent
  if (/mac/i.test(os)) return { platform: 'docker', mac: true }
  if (/win/i.test(os)) return { platform: 'windows', mac: false }
  if (/linux|x11/i.test(os) && !/android/i.test(navigator.userAgent)) return { platform: 'linux', mac: false }
  return { platform: 'windows', mac: false }
}

function action(platform: Platform)
{
  const { windows, appimage } = release.assets
  switch (platform)
  {
    case 'windows':
      return { href: windows?.url ?? RELEASES_URL, label: 'Download for Windows', meta: [megabytes(windows?.size ?? null), 'x64 installer', 'updates itself'] }
    case 'linux':
      return { href: appimage?.url ?? RELEASES_URL, label: 'Download the AppImage', meta: [megabytes(appimage?.size ?? null), 'x64', 'updates itself'] }
    case 'docker':
      return { href: links.doc('docker'), label: 'Set up with Docker', meta: ['web UI on port 3939', 'runs around the clock'] }
    case 'unraid':
      return { href: UNRAID_URL, label: 'Open in Community Apps', meta: ['search Plex Poster Helper', 'prebuilt image'] }
  }
}

/**
 * The reel-can label: the site's one primary action, a platform choice and the
 * download or setup link for it.
 *
 * @param props.compact - The stub that holds the action once the label scrolls away.
 * @param props.docked - Dock the stub as a small level label on wide screens instead of a bottom bar.
 */
export function ReelLabel({ compact = false, docked = false, id }: { compact?: boolean; docked?: boolean; id?: string })
{
  const [platform, setPlatform] = useState<Platform>('windows')
  const [mac, setMac] = useState(false)

  useEffect(() =>
  {
    const found = detect()
    setPlatform(found.platform)
    setMac(found.mac)
  }, [])

  const a = action(platform)
  const day = isoDay(release.date)

  if (compact)
  {
    return (
      <div className={`reel-stub${docked ? ' reel-stub-docked' : ''}`}>
        {docked && <p className="reel-stub-hand" aria-hidden="true">v{release.version}</p>}
        <a className="reel-go" href={a.href}>{a.label}</a>
        <a className="reel-stub-more" href={docked ? '#install' : links.doc('install')}>Other platforms</a>
      </div>
    )
  }

  return (
    <div className="reel-label" id={id}>
      <p className="reel-hand" aria-hidden="true">v{release.version}{day ? ` · ${day}` : ''}</p>
      <div className="reel-tabs" role="group" aria-label="Platform">
        {PLATFORMS.map(p => (
          <button key={p.id} type="button" aria-pressed={platform === p.id} onClick={() => setPlatform(p.id)}>{p.label}</button>
        ))}
      </div>
      <a className="reel-go" href={a.href}>{a.label}</a>
      {platform === 'linux' && release.assets.deb && (
        <a className="reel-alt" href={release.assets.deb.url}>Prefer a .deb? Download it ({megabytes(release.assets.deb.size)})</a>
      )}
      {platform === 'docker' && mac && (
        <p className="reel-alt">There is no macOS desktop build. Docker runs it on a Mac.</p>
      )}
      <p className="reel-meta">{[`v${release.version}`, ...a.meta, 'free, MIT'].filter(Boolean).join(' · ')}</p>
    </div>
  )
}
