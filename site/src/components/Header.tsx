import logo from '../../../.github/assets/logo.svg'
import { REPO_URL, release, count } from '../data/release'
import { Link, type Route } from '../lib/router'
import { links } from '../lib/site'

/**
 * Site header: the brand and the edge-print navigation shared by every page.
 *
 * @param props.current - The route being shown, marked as current.
 */
export function Header({ current }: { current: Route })
{
  const stars = count(release.stars)
  const item = (route: 'overview' | 'docs' | 'changelog', label: string) => (
    <Link href={links[route]} aria-current={current === route ? 'page' : undefined}>{label}</Link>
  )

  return (
    <header className="site-header">
      <a className="skip" href="#main">Skip to content</a>
      <Link className="brand" href={links.overview}>
        <img src={logo} alt="" width={34} height={34} draggable={false} />
        <span>Plex Poster Set Helper 2</span>
      </Link>
      <nav aria-label="Site">
        {item('overview', 'Overview')}
        {item('docs', 'Docs')}
        {item('changelog', 'Changelog')}
        <a href={REPO_URL}>GitHub{stars && <span className="nav-stars"> · {stars} stars</span>}</a>
      </nav>
    </header>
  )
}
