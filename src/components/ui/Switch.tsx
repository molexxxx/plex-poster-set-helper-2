import { useId } from 'react'
import styles from './Switch.module.css'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  /** Accessible name when the switch has no visible label of its own. */
  ariaLabel?: string
  /** Id of the element that names the switch, such as a settings row label. */
  ariaLabelledBy?: string
  /** Id of the element that describes the switch. */
  ariaDescribedBy?: string
}

/** Toggle switch with optional label and description. */
export default function Switch({ checked, onChange, label, description, disabled, ariaLabel, ariaLabelledBy, ariaDescribedBy }: SwitchProps) {
  const id = useId()

  return (
    <label htmlFor={id} className={[styles.wrapper, disabled ? styles.disabled : ''].filter(Boolean).join(' ')}>
      {(label || description) && (
        <div className={styles.text}>
          {label && <span className={styles.label}>{label}</span>}
          {description && <span className={styles.description}>{description}</span>}
        </div>
      )}
      <div className={[styles.track, checked ? styles.on : ''].join(' ')}>
        <div className={styles.thumb} />
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          className={styles.input}
          aria-label={label ? undefined : ariaLabel}
          aria-labelledby={label ? undefined : ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
        />
      </div>
    </label>
  )
}
