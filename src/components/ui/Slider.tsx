import { useId, useState, useRef, useCallback } from 'react'
import styles from './Slider.module.css'

interface SliderProps {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  label?: string
  unit?: string
  ticks?: number
  disabled?: boolean
  formatValue?: (v: number) => string
  /** Accessible name when the slider has no visible label of its own. */
  ariaLabel?: string
}

/** Single-value slider with optional ticks. */
export default function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
  unit = '',
  ticks,
  disabled = false,
  formatValue,
  ariaLabel,
}: SliderProps) {
  const id = useId()
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = ((value - min) / (max - min)) * 100
  const display = formatValue ? formatValue(value) : `${Number.isInteger(step) ? value : value.toFixed(1)}${unit}`

  const tickCount = ticks ?? Math.min(max - min + 1, 6)
  const tickValues = Array.from({ length: tickCount }, (_, i) =>
    min + Math.round((i / (tickCount - 1)) * (max - min))
  )

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value))
  }, [onChange])

  return (
    <div className={[styles.wrapper, disabled ? styles.disabled : ''].filter(Boolean).join(' ')}>
      {label && (
        <div className={styles.header}>
          <label htmlFor={id} className={styles.label}>{label}</label>
          <span className={[styles.value, dragging ? styles.valueDragging : ''].join(' ')}>
            {display}
          </span>
        </div>
      )}

      <div className={styles.trackWrap} ref={trackRef}>
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${pct}%` }} />
          <div className={styles.thumb} style={{ left: `${pct}%` }} />
        </div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => setDragging(false)}
          onTouchStart={() => setDragging(true)}
          onTouchEnd={() => setDragging(false)}
          disabled={disabled}
          className={styles.input}
          aria-valuetext={display}
          aria-label={label ? undefined : ariaLabel}
        />
      </div>

      {tickValues.length > 1 && (
        <div className={styles.ticks}>
          {tickValues.map(v => (
            <div key={v} className={styles.tick}>
              <div className={styles.tickMark} />
              <span className={styles.tickLabel}>{formatValue ? formatValue(v) : `${v}${unit}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
