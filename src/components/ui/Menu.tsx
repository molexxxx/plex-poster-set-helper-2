import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import styles from './Menu.module.css'

export interface MenuItem {
  label: string
  onSelect: () => void
  icon?: React.ReactNode
  disabled?: boolean
  danger?: boolean
}

interface MenuProps {
  /** Accessible name of the trigger and the menu, such as "More actions for Nightly sync". */
  label: string
  items: MenuItem[]
}

/** A "more actions" button that opens a keyboard-operable menu of commands. */
export default function Menu({ label, items }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const id = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const itemButtons = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    setUp(trigger.bottom + menuRef.current.offsetHeight + 72 > window.innerHeight)
    itemButtons()[0]?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function onMenuKey(e: React.KeyboardEvent) {
    const buttons = itemButtons()
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close(false)
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(at + 1) % buttons.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1]?.focus() }
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div id={id} ref={menuRef} role="menu" aria-label={label} className={`${styles.menu} ${up ? styles.menuUp : ''}`} onKeyDown={onMenuKey}>
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              className={`${styles.item} ${item.danger ? styles.itemDanger : ''}`}
              onClick={() => {
                if (item.disabled) return
                close(false)
                item.onSelect()
              }}
            >
              {item.icon && <span className={styles.icon} aria-hidden>{item.icon}</span>}
              <span className={styles.label}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
