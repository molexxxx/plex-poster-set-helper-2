import { useId } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import TypeToggles from '../../../components/ui/TypeToggles'
import type { ArtworkType } from '../../../../electron/ipc/types'
import styles from './QueueControls.module.css'


interface QueueControlsProps {
  isRunning: boolean
  idleCount: number
  doneCount: number
  errorCount: number
  /** Posters of the shown types across every entry. */
  totalPosters: number
  shownTypes: Set<ArtworkType>
  /** The types picked in Settings have been read, so they can be changed. */
  typesReady: boolean
  onRun: () => void
  onCancel: () => void
  onClear: () => void
  onTypesChange: (types: ArtworkType[]) => void
}


/** The bar above the queue: Run or Cancel, Clear All, the types to apply, and the run's counts. */
export default function QueueControls({
  isRunning, idleCount, doneCount, errorCount, totalPosters, shownTypes, typesReady, onRun, onCancel, onClear, onTypesChange,
}: QueueControlsProps) {
  const typesLabelId = useId()

  return (
    <div className={styles.controls}>
      <div className={styles.controlsLeft}>
        {!isRunning ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={13} />}
            onClick={onRun}
            disabled={idleCount === 0}
          >
            Run{idleCount > 0 ? ` (${idleCount})` : ''}
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            icon={<Square size={13} />}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={13} />}
          onClick={onClear}
          disabled={isRunning}
        >
          Clear All
        </Button>
        <span id={typesLabelId} className={styles.typesLabel}>Types to apply</span>
        <TypeToggles
          value={shownTypes}
          onChange={next => onTypesChange([...next])}
          ariaLabelledBy={typesLabelId}
          disabled={!typesReady}
        />
      </div>

      <div className={styles.controlsRight}>
        {isRunning && <Spinner size="xs" />}
        {doneCount > 0 && (
          <span className={styles.stat}>
            <span className={styles.statVal}>{doneCount}</span>
            <span className={styles.statLbl}>done</span>
          </span>
        )}
        {totalPosters > 0 && (
          <span className={styles.stat}>
            <span className={styles.statVal}>{totalPosters}</span>
            <span className={styles.statLbl}>posters</span>
          </span>
        )}
        {errorCount > 0 && (
          <span className={`${styles.stat} ${styles.statError}`}>
            <span className={styles.statVal}>{errorCount}</span>
            <span className={styles.statLbl}>error{errorCount !== 1 ? 's' : ''}</span>
          </span>
        )}
      </div>
    </div>
  )
}
