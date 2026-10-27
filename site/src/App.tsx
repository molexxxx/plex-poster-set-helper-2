import { Suspense, use, useEffect, type ComponentType } from 'react'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { PageSkeleton } from './components/PageSkeleton'
import { Landing } from './pages/Landing'
import { NotFound } from './pages/NotFound'
import { Router, routeOf, useRouter, type Route } from './lib/router'

/**
 * A page split into its own chunk that can start loading before it renders.
 * Once loaded it renders without suspending, so a navigation that waited
 * for it never shows the fallback.
 */
function deferred<M>(load: () => Promise<M>, pick: (m: M) => ComponentType)
{
  let Loaded: ComponentType | null = null
  let pending: Promise<unknown> | null = null
  const preload = () => pending ??= load().then(m => { Loaded = pick(m) })
  function Page()
  {
    if (!Loaded) use(preload())
    return Loaded ? <Loaded /> : null
  }
  return { Page, preload }
}

const docs = deferred(() => import('./pages/Docs'), m => m.Docs)
const changelog = deferred(() => import('./pages/Changelog'), m => m.Changelog)

const prepare = (route: Route) => route === 'docs' ? docs.preload() : route === 'changelog' ? changelog.preload() : undefined

prepare(routeOf(location.pathname))?.catch(() => {})

const TITLES: Record<Route, string> = {
  overview: 'Plex Poster Set Helper 2 - community poster art for your Plex library',
  docs: 'Docs - Plex Poster Set Helper 2',
  changelog: 'Changelog - Plex Poster Set Helper 2',
  missing: 'Not found - Plex Poster Set Helper 2',
}

/** The whole site as one app: header, the current page, and footer. */
export function App()
{
  return (
    <Router prepare={prepare}>
      <Shell />
    </Router>
  )
}

function Shell()
{
  const { route, visit, restore } = useRouter()

  useEffect(() =>
  {
    document.title = TITLES[route]
  }, [route])

  useEffect(() =>
  {
    const warm = () => { docs.preload().catch(() => {}); changelog.preload().catch(() => {}) }
    if ('requestIdleCallback' in window)
    {
      const id = requestIdleCallback(warm, { timeout: 4000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(warm, 2000)
    return () => clearTimeout(id)
  }, [])

  useEffect(() =>
  {
    let tries = 0
    let frame = 0
    const settle = () =>
    {
      if (restore != null)
      {
        if (document.documentElement.scrollHeight - window.innerHeight >= restore || tries > 30) window.scrollTo({ top: restore })
        else { tries++; frame = requestAnimationFrame(settle) }
        return
      }
      const id = decodeURIComponent(location.hash.slice(1))
      if (!id) { window.scrollTo({ top: 0 }); return }
      const target = document.getElementById(id)
      if (target) target.scrollIntoView()
      else if (tries++ < 120) frame = requestAnimationFrame(settle)
    }
    settle()
    return () => cancelAnimationFrame(frame)
  }, [route, visit, restore])

  return (
    <>
      <Header current={route} />
      <Suspense fallback={<PageSkeleton route={route} />}>
        {route === 'overview' && <Landing />}
        {route === 'docs' && <docs.Page />}
        {route === 'changelog' && <changelog.Page />}
        {route === 'missing' && <NotFound />}
      </Suspense>
      <Footer />
    </>
  )
}
