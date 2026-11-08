import { useState, useRef, useEffect, useId } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Check, Search } from 'lucide-react'
import styles from './Select.module.css'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  description?: string
  icon?: React.ReactNode
  disabled?: boolean
}

interface SelectProps<T extends string = string> {
  options: SelectOption<T>[]
  value: T | null
  onChange: (value: T) => void
  placeholder?: string
  label?: string
  searchable?: boolean
  disabled?: boolean
  error?: string
  /** Id of an external label, such as a settings row label; read before the selected value. */
  ariaLabelledBy?: string
}

/** Custom dropdown select with optional search. */
export default function Select<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  label,
  searchable = false,
  disabled = false,
  error,
  ariaLabelledBy,
}: SelectProps<T>) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)
  const filtered = searchable && query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    if (open && searchable) setTimeout(() => searchRef.current?.focus(), 50)
    if (!open) setQuery('')
  }, [open, searchable])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v) }
  }

  return (
    <div className={styles.wrapper} ref={containerRef}>
      {label && <label htmlFor={id} className={styles.label}>{label}</label>}

      <button
        id={id}
        type="button"
        className={[styles.trigger, open ? styles.open : '', error ? styles.hasError : '', disabled ? styles.disabled : ''].filter(Boolean).join(' ')}
        onClick={() => !disabled && setOpen(v => !v)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${id}` : undefined}
        disabled={disabled}
      >
        <span className={[styles.triggerLabel, !selected ? styles.placeholder : ''].join(' ')}>
          {selected?.icon && <span className={styles.optionIcon}>{selected.icon}</span>}
          {selected?.label ?? placeholder}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown size={14} />
        </motion.span>
      </button>

      {error && <p className={styles.error}>{error}</p>}

      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.dropdown}
            initial={{ opacity: 0, y: -6, scaleY: 0.95 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -6, scaleY: 0.95 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: 'top' }}
            role="listbox"
          >
            {searchable && (
              <div className={styles.search}>
                <Search size={12} />
                <input
                  ref={searchRef}
                  className={styles.searchInput}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search…"
                  onClick={e => e.stopPropagation()}
                />
              </div>
            )}

            <div className={styles.list}>
              {filtered.length === 0 ? (
                <div className={styles.empty}>No results</div>
              ) : (
                filtered.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={[styles.option, opt.value === value ? styles.selected : '', opt.disabled ? styles.optionDisabled : ''].filter(Boolean).join(' ')}
                    onClick={() => { if (!opt.disabled) { onChange(opt.value); setOpen(false) } }}
                    role="option"
                    aria-selected={opt.value === value}
                    disabled={opt.disabled}
                  >
                    {opt.icon && <span className={styles.optionIcon}>{opt.icon}</span>}
                    <span className={styles.optionText}>
                      <span>{opt.label}</span>
                      {opt.description && <span className={styles.optionDesc}>{opt.description}</span>}
                    </span>
                    {opt.value === value && <Check size={12} className={styles.check} />}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
