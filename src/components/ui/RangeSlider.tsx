import { useId } from 'react'
import styles from './RangeSlider.module.css'

interface Props {
  min: number
  max: number
  step?: number
  minVal: number
  maxVal: number
  onChange: (min: number, max: number) => void
  unit?: string
  ticks?: number
  disabled?: boolean
}

export default function RangeSlider({
  min, max, step = 0.1, minVal, maxVal, onChange, unit = '', ticks = 6, disabled = false,
}: Props) {
  const idMin = useId()
  const idMax = useId()

  const minPct = ((minVal - min) / (max - min)) * 100
  const maxPct = ((maxVal - min) / (max - min)) * 100

  const fmt = (v: number) =>
    `${Number.isInteger(step) ? v : v.toFixed(1)}${unit}`

  function handleMin(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Math.min(Number(e.target.value), maxVal - step)
    onChange(Math.round(v / step) * step, maxVal)
  }

  function handleMax(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Math.max(Number(e.target.value), minVal + step)
    onChange(minVal, Math.round(v / step) * step)
  }

  const tickValues = Array.from({ length: ticks }, (_, i) => {
    const raw = min + (i / (ticks - 1)) * (max - min)
    return Math.round(raw / step) * step
  })

  return (
    <div className={[styles.wrapper, disabled ? styles.disabled : ''].filter(Boolean).join(' ')}>

      {/* ── Value readout ── */}
      <div className={styles.readout}>
        <span className={styles.val}>{fmt(minVal)}</span>
        <span className={styles.dash}>—</span>
        <span className={styles.val}>{fmt(maxVal)}</span>
      </div>

      {/* ── Track ── */}
      <div className={styles.trackWrap}>
        {/* Visual track + fill + thumbs */}
        <div className={styles.track} aria-hidden>
          <div
            className={styles.fill}
            style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
          />
          <div className={styles.thumb} style={{ left: `${minPct}%` }} />
          <div className={styles.thumb} style={{ left: `${maxPct}%` }} />
        </div>

        {/* Invisible native inputs drive interaction */}
        <input
          id={idMin}
          type="range"
          min={min} max={max} step={step}
          value={minVal}
          onChange={handleMin}
          disabled={disabled}
          className={styles.input}
          style={{ zIndex: minVal > (min + max) / 2 ? 5 : 4 }}
        />
        <input
          id={idMax}
          type="range"
          min={min} max={max} step={step}
          value={maxVal}
          onChange={handleMax}
          disabled={disabled}
          className={styles.input}
          style={{ zIndex: maxVal < (min + max) / 2 ? 5 : 4 }}
        />
      </div>

      {/* ── Ticks ── */}
      {tickValues.length > 1 && (
        <div className={styles.ticks}>
          {tickValues.map((v, i) => (
            <div key={i} className={styles.tick}>
              <div className={styles.tickMark} />
              <span className={styles.tickLabel}>{fmt(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
