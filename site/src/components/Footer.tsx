import { DOCKER_HUB_URL, ISSUES_URL, REPO_URL, RELEASES_URL, UNRAID_URL, release, isoDay } from '../data/release'
import { Link } from '../lib/router'
import { links } from '../lib/site'

/** Footer with the outbound links and the release the site was built from. */
export function Footer()
{
  const day = isoDay(release.date)
  return (
    <footer className="site-footer">
      <nav aria-label="Elsewhere">
        <a href={REPO_URL}>GitHub</a>
        <a href={RELEASES_URL}>Releases</a>
        <a href={DOCKER_HUB_URL}>Docker Hub</a>
        <a href={UNRAID_URL}>Unraid listing</a>
        <a href={ISSUES_URL}>Report an issue</a>
        <Link href={links.docs}>Docs</Link>
        <Link href={links.changelog}>Changelog</Link>
      </nav>
      <p>Plex Poster Set Helper 2 v{release.version}{day ? `, released ${day}` : ''}. MIT license.</p>
    </footer>
  )
}
