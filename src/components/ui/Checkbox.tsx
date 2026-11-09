import { useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './Checkbox.module.css'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  indeterminate?: boolean
  label?: string
  disabled?: boolean
  /** Accessible name when there is no visible label. */
  ariaLabel?: string
}

/** Styled checkbox with optional label and indeterminate state. */
export default function Checkbox({ checked, onChange, indeterminate, label, disabled, ariaLabel }: CheckboxProps) {
  const id = useId()

  return (
    <label htmlFor={id} className={[styles.wrapper, disabled ? styles.disabled : ''].filter(Boolean).join(' ')}>
      <div className={[styles.box, checked || indeterminate ? styles.checked : ''].join(' ')}>
        <AnimatePresence>
          {indeterminate ? (
            <motion.div key="dash" className={styles.dash}
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              transition={{ duration: 0.12, ease: [0.34, 1.56, 0.64, 1] }}
            />
          ) : checked ? (
            <motion.svg key="check" width="10" height="8" viewBox="0 0 10 8" fill="none"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.14, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </motion.svg>
          ) : null}
        </AnimatePresence>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          className={styles.input}
          ref={el => { if (el) el.indeterminate = !!indeterminate }}
        />
      </div>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  )
}
