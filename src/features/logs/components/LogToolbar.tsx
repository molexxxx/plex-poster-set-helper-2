import { useId, type RefObject } from 'react'
import { CheckCircle2, Copy, Maximize2, Search, X } from 'lucide-react'
import Segmented from '../../../components/ui/Segmented'
import Select, { type SelectOption } from '../../../components/ui/Select'
import Menu, { type MenuItem } from '../../../components/ui/Menu'
import Button from '../../../components/ui/Button'
import type { Severity } from '../logView'
import shared from './logShared.module.css'
import styles from './LogToolbar.module.css'

const SEVERITY_OPTIONS: Array<{ value: Severity; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'warn', label: 'Warnings and errors' },
  { value: 'error', label: 'Errors' },
]

interface LogToolbarProps
{
  mode: 'drawer' | 'page' | 'window'
  /** Shows the day picker; the drawer only ever reads the newest lines. */
  pickDays: boolean
  dayOptions: SelectOption[]
  day: string
  onPickDay: (day: string) => void
  severity: Severity
  onSeverity: (severity: Severity) => void
  query: string
  onQuery: (query: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  /** How many lines show, of how many are loaded; blank while loading. */
  countText: string
  copied: boolean
  canCopy: boolean
  onCopy: () => void
  menuItems: MenuItem[]
  onExpand?: () => void
  onClose?: () => void
}

/** The log viewer's toolbar: day, severity, search, the line count, Copy, and the actions menu. */
export default function LogToolbar({
  mode, pickDays, dayOptions, day, onPickDay, severity, onSeverity, query, onQuery, searchRef,
  countText, copied, canCopy, onCopy, menuItems, onExpand, onClose,
}: LogToolbarProps)
{
  const dayLabelId = useId()

  return (
    <div className={styles.toolbar}>
      {mode === 'drawer' && <h2 className={styles.title}>Logs</h2>}
      {pickDays && (
        <div className={styles.daySelect}>
          <span id={dayLabelId} className={shared.srOnly}>Day</span>
          <Select options={dayOptions} value={day} onChange={onPickDay} placeholder="Newest lines" ariaLabelledBy={dayLabelId} />
        </div>
      )}
      <Segmented options={SEVERITY_OPTIONS} value={severity} onChange={onSeverity} ariaLabel="Show" />
      <label className={styles.search}>
        <Search size={13} aria-hidden />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder="Search logs"
          aria-label="Search logs"
          spellCheck={false}
        />
      </label>
      <span className={styles.spacer} />
      <span className={styles.count} aria-live="off">{countText}</span>
      <div className={styles.actions}>
        <Button
          variant="ghost" size="sm"
          icon={copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
          onClick={onCopy}
          disabled={!canCopy}
          title="Copy the lines shown, as plain text"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Menu label="More log actions" items={menuItems} />
        {onExpand && (
          <Button variant="ghost" size="sm" icon={<Maximize2 size={13} />} onClick={onExpand} aria-label="Open the full Logs page" title="Open the full Logs page" />
        )}
        {onClose && (
          <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onClose} aria-label="Close logs" title="Close logs (Esc)" />
        )}
      </div>
    </div>
  )
}
