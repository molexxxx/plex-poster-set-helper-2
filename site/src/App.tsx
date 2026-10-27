import { lazy, Suspense, useEffect } from 'react'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { Landing } from './pages/Landing'
import { NotFound } from './pages/NotFound'
import { Router, useRouter, type Route } from './lib/router'

const Docs = lazy(() => import('./pages/Docs').then(m => ({ default: m.Docs })))
const Changelog = lazy(() => import('./pages/Changelog').then(m => ({ default: m.Changelog })))

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
    <Router>
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
      else if (tries++ < 60) frame = requestAnimationFrame(settle)
    }
    settle()
    return () => cancelAnimationFrame(frame)
  }, [route, visit, restore])

  return (
    <>
      <Header current={route} />
      <Suspense fallback={<main id="main" className="page-loading" aria-busy="true" />}>
        {route === 'overview' && <Landing />}
        {route === 'docs' && <Docs />}
        {route === 'changelog' && <Changelog />}
        {route === 'missing' && <NotFound />}
      </Suspense>
      <Footer />
    </>
  )
}
