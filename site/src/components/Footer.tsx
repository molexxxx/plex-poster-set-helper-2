import logo from '../../../.github/assets/logo.svg'
import { DOCKER_HUB_URL, ISSUES_URL, REPO_URL, RELEASES_URL, UNRAID_URL, release, isoDay } from '../data/release'
import { Perfs } from './Film'
import { Link } from '../lib/router'
import { links } from '../lib/site'

/** The reel's tail leader: the outbound links in groups and the release the site was built from as edge print. */
export function Footer()
{
  const print = ['Plex Poster Set Helper 2', `V${release.version}`, isoDay(release.date), 'MIT license'].filter(Boolean)
  return (
    <footer className="site-footer">
      <Perfs edge="top" />
      <div className="footer-body">
        <Link className="brand" href={links.overview}>
          <img src={logo} alt="" width={34} height={34} draggable={false} />
          <span>Plex Poster Set Helper 2</span>
        </Link>
        <nav aria-label="Elsewhere">
          <div className="footer-group">
            <h2>Install</h2>
            <ul>
              <li><a href={RELEASES_URL}>Releases</a></li>
              <li><a href={DOCKER_HUB_URL}>Docker Hub</a></li>
              <li><a href={UNRAID_URL}>Unraid listing</a></li>
            </ul>
          </div>
          <div className="footer-group">
            <h2>Read</h2>
            <ul>
              <li><Link href={links.docs}>Docs</Link></li>
              <li><Link href={links.changelog}>Changelog</Link></li>
            </ul>
          </div>
          <div className="footer-group">
            <h2>Project</h2>
            <ul>
              <li><a href={REPO_URL}>GitHub</a></li>
              <li><a href={ISSUES_URL}>Report an issue</a></li>
            </ul>
          </div>
        </nav>
      </div>
      <p className="footer-print">
        {print.map((item, i) => <span key={item}>{i > 0 && <span aria-hidden="true"> ▸ </span>}{item}</span>)}
      </p>
      <Perfs edge="bottom" />
    </footer>
  )
}
