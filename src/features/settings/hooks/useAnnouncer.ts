import { useCallback, useState } from 'react'

/**
 * A message for screen readers, read out by a polite live region.
 *
 * @returns The current message, and `announce`, which clears it first so a repeated message is read again.
 */
export function useAnnouncer()
{
  const [announcement, setAnnouncement] = useState('')

  const announce = useCallback((message: string) =>
  {
    setAnnouncement('')
    setTimeout(() => setAnnouncement(message), 30)
  }, [])

  return { announcement, announce }
}
