import { useEffect, useState } from 'react'
/** The current time in milliseconds, refreshed on an interval so relative times stay current. */
export function useNow(intervalMs = 30_000): number
{
  const [now, setNow] = useState(() => Date.now())
  useEffect(() =>
  {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
