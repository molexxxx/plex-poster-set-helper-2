import logo from '../../../.github/assets/logo.svg'
import { REPO_URL, release, count } from '../data/release'
import { links, type Page } from '../lib/site'

/**
 * Site header: the brand and the edge-print navigation shared by every page.
 *
 * @param props.current - The page being shown, marked as current.
 */
export function Header({ current }: { current: Page })
{
  const stars = count(release.stars)
  const item = (page: Page, label: string) => (
    <a href={links[page]} aria-current={current === page ? 'page' : undefined}>{label}</a>
  )

  return (
    <header className="site-header">
      <a className="skip" href="#main">Skip to content</a>
      <a className="brand" href={links.overview}>
        <img src={logo} alt="" width={34} height={34} />
        <span>Plex Poster Set Helper 2</span>
      </a>
      <nav aria-label="Site">
        {item('overview', 'Overview')}
        {item('docs', 'Docs')}
        {item('changelog', 'Changelog')}
        <a href={REPO_URL}>GitHub{stars && <span className="nav-stars"> · {stars} stars</span>}</a>
      </nav>
    </header>
  )
}
