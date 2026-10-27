import { useState } from 'react'
import { release, megabytes, count, RELEASES_URL, UNRAID_URL } from '../data/release'
import { links } from '../lib/site'

const DOCKER = `git clone https://github.com/molexxxx/plex-poster-set-helper-2.git
cd plex-poster-set-helper-2
./docker/run.sh`

/** The install table: every way to run the app, with the real file sizes from the latest release. */
export function BoothLog()
{
  const { windows, appimage, deb } = release.assets
  const downloads = count(release.downloads)
  const allDownloads = count(release.allDownloads)
  const [copied, setCopied] = useState(false)

  const copy = async () =>
  {
    try
    {
      await navigator.clipboard.writeText(DOCKER)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    catch
    {
      setCopied(false)
    }
  }

  return (
    <section className="booth-log" id="install" aria-labelledby="install-title">
      <div className="section-head">
        <h2 id="install-title">Get your copy</h2>
        <p>
          The desktop app for Windows and Linux, or the same app as a web page in Docker. You need a Plex Media Server and a Plex account that can manage it.
          {downloads && <> Installers have been downloaded <span className="num">{downloads}</span> times across all releases{allDownloads ? <>, and <span className="num">{allDownloads}</span> times counting the app's update checks</> : null}.</>}
        </p>
      </div>
      <table>
        <thead>
          <tr><th scope="col">Platform</th><th scope="col">What you get</th><th scope="col">Size</th><th scope="col"><span className="sr-only">Link</span></th></tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Windows</th>
            <td>Installer for x64. The app checks GitHub and updates itself.</td>
            <td className="num">{megabytes(windows?.size ?? null)}</td>
            <td><a className="log-go" href={windows?.url ?? RELEASES_URL}>Download .exe</a></td>
          </tr>
          <tr>
            <th scope="row">Linux</th>
            <td>AppImage for x64, updating itself, or a .deb package.</td>
            <td className="num">{megabytes(appimage?.size ?? null)}</td>
            <td>
              <a className="log-go" href={appimage?.url ?? RELEASES_URL}>Download AppImage</a>
              {deb && <a className="log-alt" href={deb.url}>.deb ({megabytes(deb.size)})</a>}
            </td>
          </tr>
          <tr>
            <th scope="row">Docker</th>
            <td>The full app as a web page on port 3939. Schedules keep running as long as the container is up.</td>
            <td className="num" />
            <td><a className="log-go" href={links.doc('docker')}>Setup steps</a></td>
          </tr>
          <tr>
            <th scope="row">Unraid</th>
            <td>Search Plex Poster Helper in Community Applications. It pulls the prebuilt image and adds a WebUI button.</td>
            <td className="num" />
            <td><a className="log-go" href={UNRAID_URL}>Open listing</a></td>
          </tr>
          <tr>
            <th scope="row">macOS</th>
            <td>No desktop build. Run the Docker version instead.</td>
            <td className="num" />
            <td><a className="log-go" href={links.doc('docker')}>Docker steps</a></td>
          </tr>
        </tbody>
      </table>
      <div className="docker-snippet">
        <div className="docker-snippet-head">
          <p>Docker in three lines. On Windows, run <code>./docker/run.ps1</code> in PowerShell for the last one, then open <code>http://localhost:3939</code>.</p>
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy commands'}</button>
        </div>
        <pre><code>{DOCKER}</code></pre>
      </div>
    </section>
  )
}
