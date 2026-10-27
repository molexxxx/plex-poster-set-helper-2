import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

const BASE = import.meta.env.BASE_URL

export type Route = 'overview' | 'docs' | 'changelog' | 'missing'

/**
 * Maps a pathname under the site's base path to a route.
 *
 * @param pathname - For example "/plex-poster-set-helper-2/docs/".
 * @returns The route it shows.
 */
export function routeOf(pathname: string): Route
{
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '')
  const segment = rest.replace(/index\.html$/, '').replace(/\/+$/, '')
  if (segment === '') return 'overview'
  if (segment === 'docs') return 'docs'
  if (segment === 'changelog') return 'changelog'
  return 'missing'
}

interface RouterState
{
  route: Route
  /** Bumped on every navigation, so effects can run again for the same route. */
  visit: number
  /** Scroll position to restore after a back or forward navigation, if any. */
  restore: number | null
  navigate: (href: string) => void
}

const RouterContext = createContext<RouterState>({ route: 'overview', visit: 0, restore: null, navigate: () => {} })

/** Client-side routing over the History API, with a view transition between pages when supported. */
export function Router({ children }: { children: ReactNode })
{
  const [state, setState] = useState(() => ({ route: routeOf(location.pathname), visit: 0, restore: null as number | null }))

  useEffect(() =>
  {
    history.scrollRestoration = 'manual'
    const onPop = (e: PopStateEvent) =>
    {
      const saved = typeof e.state?.scroll === 'number' ? e.state.scroll : 0
      setState(s => ({ route: routeOf(location.pathname), visit: s.visit + 1, restore: saved }))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((href: string) =>
  {
    const url = new URL(href, location.href)
    if (url.pathname === location.pathname && url.search === location.search)
    {
      if (url.hash) location.hash = url.hash
      else window.scrollTo({ top: 0 })
      return
    }
    history.replaceState({ ...history.state, scroll: window.scrollY }, '')
    const go = () =>
    {
      history.pushState({ scroll: 0 }, '', url.pathname + url.search + url.hash)
      setState(s => ({ route: routeOf(url.pathname), visit: s.visit + 1, restore: null }))
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (document.startViewTransition && !reduced) document.startViewTransition(() => flushSync(go))
    else go()
  }, [])

  const value = useMemo(() => ({ ...state, navigate }), [state, navigate])
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

/** The current route and the navigate function. */
export function useRouter(): RouterState
{
  return useContext(RouterContext)
}

/**
 * A link that moves between the site's pages without a page load. External
 * links, new-tab clicks, and modified clicks behave as normal anchors.
 */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string })
{
  const { navigate } = useRouter()
  const handle = (e: MouseEvent<HTMLAnchorElement>) =>
  {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return
    const url = new URL(href, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return
    e.preventDefault()
    navigate(href)
  }
  return <a href={href} onClick={handle} {...rest} />
}
