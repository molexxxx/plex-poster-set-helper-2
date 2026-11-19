import { useEffect, useRef, useState } from 'react'
import { ALL_TYPES, type FileType } from '../../../../utils/posterGroups'
import { DEFAULT_QUICK_CRON } from '../../../../../electron/services/scheduleUtils'
import { PANEL_WIDTH_DEFAULT, clampPanelWidth } from '../setsPanelUtils'

/**
 * The panel's settings from config, read on mount: the artwork types the
 * toggles start from, whether a TMDB key is set, the quick-sync schedule, and
 * the panel width, which the resize handle changes and saves.
 *
 * @returns The types with the Settings choice, the TMDB key flag, the
 *   quick-sync schedule, whether a resize is running, and the resize handlers.
 */
export function usePanelSettings()
{
  const [hasTmdbKey, setHasTmdbKey] = useState(false)
  const [types, setTypes]       = useState<Set<FileType>>(new Set(ALL_TYPES))
  // The Settings choice the toggles start from; a job scheduled from here keeps
  // following it unless the toggles were changed.
  const [settingsTypes, setSettingsTypes] = useState<FileType[]>(ALL_TYPES)
  const [quickCron, setQuickCron] = useState(DEFAULT_QUICK_CRON)
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH_DEFAULT)
  const panelWidthRef = useRef(PANEL_WIDTH_DEFAULT)
  const [resizing, setResizing] = useState(false)

  useEffect(() =>
  {
    window.api.config.get().then(c =>
    {
      if (c.mediuxFilters?.length) setTypes(new Set(c.mediuxFilters as FileType[]))
      if (c.mediuxFilters) setSettingsTypes(c.mediuxFilters)
      setHasTmdbKey(Boolean(c.tmdbApiKey?.trim()))
      setQuickCron(c.schedulerQuickCron || DEFAULT_QUICK_CRON)
      const w = clampPanelWidth(c.libraryPanelWidth ?? PANEL_WIDTH_DEFAULT)
      panelWidthRef.current = w
      setPanelWidth(w)
    })
  }, [])

  // The grid's reserved gap and the panel itself both read --library-panel-width,
  // so a resize updates both from one value. We don't clear it on unmount: while
  // switching between items both panels are briefly mounted, and the outgoing
  // one's cleanup would otherwise wipe the width the incoming one just set. The
  // grid only consumes the gap while a panel is open, so a stale value is inert.
  useEffect(() =>
  {
    document.documentElement.style.setProperty('--library-panel-width', `${panelWidth}px`)
  }, [panelWidth])

  function startPanelResize(e: React.MouseEvent)
  {
    e.preventDefault()
    const startX = e.clientX
    const startW = panelWidthRef.current
    setResizing(true)

    function onMove(ev: MouseEvent)
    {
      const next = clampPanelWidth(startW + (startX - ev.clientX))
      panelWidthRef.current = next
      // Drive the drag straight through the CSS var: the panel and the grid gap
      // both track the cursor 1:1 without re-rendering the (heavy) panel on every
      // frame - the per-frame React re-render is what made resizing stutter. The
      // final value is committed to state in onUp so React stays in sync.
      document.documentElement.style.setProperty('--library-panel-width', `${next}px`)
    }

    function onUp()
    {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      setPanelWidth(panelWidthRef.current)
      window.api.config.set({ libraryPanelWidth: panelWidthRef.current }).catch(() => {})
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function resetPanelWidth()
  {
    const w = clampPanelWidth(PANEL_WIDTH_DEFAULT)
    panelWidthRef.current = w
    setPanelWidth(w)
    window.api.config.set({ libraryPanelWidth: w }).catch(() => {})
  }

  return { hasTmdbKey, types, setTypes, settingsTypes, quickCron, resizing, startPanelResize, resetPanelWidth }
}
