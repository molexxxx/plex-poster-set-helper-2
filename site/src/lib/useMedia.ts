import { useEffect, useState } from 'react'

/**
 * Tracks a media query.
 *
 * @param query - For example "(prefers-reduced-motion: reduce)".
 * @returns Whether it currently matches.
 */
export function useMedia(query: string): boolean
{
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)

  useEffect(() =>
  {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])

  return matches
}
