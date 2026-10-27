/**
 * Writes src/data/release.json from the GitHub API: the latest release, its
 * installers, every release date, installer downloads across all releases, all
 * release-file downloads including the app's update checks, and the star count.
 * Every number the site prints comes from this file. When the API cannot be
 * reached it falls back to the version in the app's package.json, links built
 * from the release asset naming pattern, and no counts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'molexxxx/plex-poster-set-helper-2'
const INSTALLER = /\.(exe|AppImage|deb|dmg|zip)$/
const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../src/data/release.json')

const headers = { accept: 'application/vnd.github+json', 'user-agent': 'ppsh2-site-build' }
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`

async function api(path)
{
  const res = await fetch(`https://api.github.com/${path}`, { headers })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

function pick(assets, test)
{
  const a = assets.find(x => test.test(x.name))
  return a ? { name: a.name, size: a.size, url: a.browser_download_url } : null
}

function fallback(reason)
{
  const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8'))
  const v = pkg.version
  const base = `https://github.com/${REPO}/releases/download/v${v}`
  console.warn(`release-data: using fallback (${reason})`)
  return {
    version: v,
    tag: `v${v}`,
    date: null,
    assets: {
      windows: { name: `Plex-Poster-Set-Helper-2-Setup-${v}-Windows.exe`, size: null, url: `${base}/Plex-Poster-Set-Helper-2-Setup-${v}-Windows.exe` },
      appimage: { name: `Plex-Poster-Set-Helper-2-${v}-x86_64.AppImage`, size: null, url: `${base}/Plex-Poster-Set-Helper-2-${v}-x86_64.AppImage` },
      deb: { name: `Plex-Poster-Set-Helper-2-${v}-Linux.deb`, size: null, url: `${base}/Plex-Poster-Set-Helper-2-${v}-Linux.deb` },
    },
    releases: [],
    downloads: null,
    allDownloads: null,
    stars: null,
    fetchedAt: new Date().toISOString(),
  }
}

async function main()
{
  let data
  try
  {
    const [releases, repo] = await Promise.all([api(`repos/${REPO}/releases?per_page=100`), api(`repos/${REPO}`)])
    const published = releases.filter(r => !r.draft && !r.prerelease)
    const latest = published[0]
    if (!latest) throw new Error('no published release')
    data = {
      version: latest.tag_name.replace(/^v/, ''),
      tag: latest.tag_name,
      date: latest.published_at,
      assets: {
        windows: pick(latest.assets, /Setup-.*-Windows\.exe$/),
        appimage: pick(latest.assets, /\.AppImage$/),
        deb: pick(latest.assets, /\.deb$/),
      },
      releases: published.map(r => ({ tag: r.tag_name, date: r.published_at })),
      downloads: published.flatMap(r => r.assets).filter(a => INSTALLER.test(a.name)).reduce((n, a) => n + a.download_count, 0),
      allDownloads: published.flatMap(r => r.assets).reduce((n, a) => n + a.download_count, 0),
      stars: repo.stargazers_count,
      fetchedAt: new Date().toISOString(),
    }
  }
  catch (err)
  {
    data = fallback(err instanceof Error ? err.message : String(err))
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(data, null, 2) + '\n')
  console.log(`release-data: ${data.tag}, ${data.releases.length} releases, ${data.downloads ?? 'unknown'} downloads`)
}

main()
