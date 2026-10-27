import { Link } from '../lib/router'
import { links } from '../lib/site'

/** Shown for any path the site doesn't have. */
export function NotFound()
{
  return (
    <main id="main" className="not-found">
      <h1>This frame isn't on the reel.</h1>
      <p className="lede">The page you asked for doesn't exist. Try one of these instead.</p>
      <p className="not-found-links">
        <Link href={links.overview}>Overview</Link>
        <Link href={links.docs}>Docs</Link>
        <Link href={links.changelog}>Changelog</Link>
      </p>
    </main>
  )
}
