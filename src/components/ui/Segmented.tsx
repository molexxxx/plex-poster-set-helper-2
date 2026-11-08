import styles from './Segmented.module.css'

interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  /** Id of the element that names the group. */
  ariaLabelledBy?: string
  ariaLabel?: string
}

/** One choice from a few, as a radio group the arrow keys move through. */
export default function Segmented<T extends string>({ options, value, onChange, ariaLabelledBy, ariaLabel }: SegmentedProps<T>) {
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = options.findIndex(o => o.value === value)
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % options.length
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + options.length) % options.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? options.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].value)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div className={styles.group} role="radiogroup" aria-labelledby={ariaLabelledBy} aria-label={ariaLabel} onKeyDown={onKey}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          className={`${styles.segment} ${value === o.value ? styles.active : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
