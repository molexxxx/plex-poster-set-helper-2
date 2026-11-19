import { useCallback, useEffect, useRef, useState } from 'react'

const NOTICE_MS = 5000
const NOTICE_LONG_MS = 12000

/** done confirms an action; warn confirms one the user should follow up on; error reports a failure. */
export type NoticeTone = 'done' | 'warn' | 'error'

/** A message shown over the log lines until it times out or is dismissed. */
export interface LogNoticeMessage
{
  text: string
  tone: NoticeTone
}

/**
 * The log viewer's notices and screen reader announcements. A notice clears
 * itself after a few seconds, later for one the user should act on.
 *
 * @returns The current notice and announcement, with `notify`, `dismissNotice`, and `announce`.
 */
export function useLogNotice()
{
  const [announcement, setAnnouncement] = useState('')
  const [notice, setNotice] = useState<LogNoticeMessage | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const announce = useCallback((message: string) =>
  {
    setAnnouncement('')
    setTimeout(() => setAnnouncement(message), 30)
  }, [])

  const notify = useCallback((text: string, tone: NoticeTone = 'done') =>
  {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice({ text, tone })
    noticeTimer.current = setTimeout(() => setNotice(null), tone === 'done' ? NOTICE_MS : NOTICE_LONG_MS)
  }, [])

  function dismissNotice()
  {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice(null)
  }

  useEffect(() => () =>
  {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
  }, [])

  return { notice, notify, dismissNotice, announcement, announce }
}
