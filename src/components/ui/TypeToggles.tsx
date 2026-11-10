import type { ArtworkType } from '../../../electron/ipc/types'
import { ARTWORK_TYPES } from '../../../electron/services/scheduleUtils'
import { toggleFileType } from '../../utils/posterGroups'
import styles from './TypeToggles.module.css'

const LABELS: Record<ArtworkType, string> = { poster: 'Posters', backdrop: 'Backdrops', title_card: 'Title cards' }

interface Props {
  value: Iterable<ArtworkType>
  onChange: (next: Set<ArtworkType>) => void
  /** Accessible name when no visible label is linked through `ariaLabelledBy`. */
  label?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  disabled?: boolean
  className?: string
}

/** Posters, backdrops, and title cards as toggle buttons. At least one stays on. */
export default function TypeToggles({ value, onChange, label = 'Artwork types', ariaLabelledBy, ariaDescribedBy, disabled, className }: Props) {
  const on = new Set(value)

  function toggle(type: ArtworkType) {
    const next = toggleFileType(on, type)
    if (next) onChange(next)
  }

  return (
    <div
      role="group"
      aria-label={ariaLabelledBy ? undefined : label}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={`${styles.group} ${className ?? ''}`}
    >
      {ARTWORK_TYPES.map(type => {
        const pressed = on.has(type)
        return (
          <button
            key={type}
            type="button"
            aria-pressed={pressed}
            className={`${styles.toggle} ${pressed ? styles.on : ''}`}
            onClick={() => toggle(type)}
            disabled={disabled}
            title={pressed && on.size === 1 ? 'At least one type stays on' : undefined}
          >
            {LABELS[type]}
          </button>
        )
      })}
    </div>
  )
}
