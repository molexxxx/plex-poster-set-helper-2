import { useId, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import Switch from '../../components/ui/Switch'
import TypeToggles from '../../components/ui/TypeToggles'
import type { MediuxUserSet, ScheduledJob } from '../../../electron/ipc/types'
import type { FileType } from '../../utils/posterGroups'
import { uuid } from '../../utils/uuid'
import { errorMessage } from '../../utils/errorMessage'
import {
  QUICK_SCHEDULES, artworkOverride, creatorSyncUrl, describeCron, describeQuickSync, planQuickSync, type QuickSyncRequest,
} from '../../../electron/services/scheduleUtils'
import styles from './Creators.module.css'

/** What the dialog syncs: everything the creator publishes, or a chosen handful of sets. */
export type SyncScope = { kind: 'creator' } | { kind: 'sets'; sets: MediuxUserSet[] }

type Start = 'new' | 'everything'

interface Props {
  open: boolean
  username: string
  scope: SyncScope
  jobs: ScheduledJob[]
  /** Titles in the library this creator has art for, for the "everything now" scope line. */
  matchedTitles: number
  defaultCron: string
  /** Types picked in the Creators view; a new sync starts from them. */
  pickedTypes: Set<FileType>
  settingsTypes: FileType[]
  onClose: () => void
  onSaved: (message: string, jobId: string) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Sets up or edits a creator sync: when it runs, whether it starts from today's
 * uploads or applies the whole catalog now, which artwork types it applies,
 * and whether it only fills gaps.
 * Nothing is scheduled until the user confirms with the scope spelled out.
 */
export default function CreatorSyncDialog({ open, username, scope, jobs, matchedTitles, defaultCron, pickedTypes, settingsTypes, onClose, onSaved }: Props) {
  const scheduleLabelId = useId()
  const typesLabelId = useId()
  const typesDescId = useId()
  const gapsLabelId = useId()
  const gapsDescId = useId()
  const startName = useId()
  const startLabelId = useId()
  const isCreator = scope.kind === 'creator'

  const request = useMemo<QuickSyncRequest>(() => {
    const urls = scope.kind === 'creator' ? [creatorSyncUrl(username)] : scope.sets.map(s => `https://mediux.pro/sets/${s.id}`)
    const count = scope.kind === 'sets' ? scope.sets.length : 0
    return {
      urls,
      name: scope.kind === 'creator' ? `Sync @${username}` : `Sync @${username} (${count} ${count === 1 ? 'set' : 'sets'})`,
      cronExpr: defaultCron,
      creator: username,
      groupByCreator: true,
    }
  }, [scope, username, defaultCron])

  const target = useMemo(() => planQuickSync(jobs, request, () => 'preview'), [jobs, request])
  const existing = target.kind === 'create' ? null : target.job

  const [cronExpr, setCronExpr] = useState(existing?.cronExpr ?? defaultCron)
  const [fillGaps, setFillGaps] = useState(!!existing?.fillGaps)
  const [start, setStart] = useState<Start>(existing && !existing.since ? 'everything' : 'new')
  const [assetTypes, setAssetTypes] = useState<FileType[] | undefined>(() => (existing ? existing.assetTypes : artworkOverride(pickedTypes, settingsTypes)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scheduleOptions = (QUICK_SCHEDULES.includes(cronExpr) ? QUICK_SCHEDULES : [...QUICK_SCHEDULES, cronExpr])
    .map(expr => ({ value: expr, label: describeCron(expr) }))
  const since = existing?.since
  const setCount = scope.kind === 'sets' ? scope.sets.length : 0

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const overrides: QuickSyncRequest['overrides'] = isCreator
        ? { cronExpr, fillGaps, assetTypes, since: start === 'new' ? since ?? new Date().toISOString() : undefined }
        : { cronExpr, fillGaps, assetTypes }
      const plan = planQuickSync(await window.api.scheduler.list(), { ...request, overrides }, uuid)
      const saved = plan.kind === 'exists' ? plan.job : await window.api.scheduler.save(plan.job)
      const when = describeCron(saved.cronExpr).toLowerCase()
      const message = !isCreator
        ? describeQuickSync({ ...plan, job: saved }, setCount, username)
        : saved.since
          ? `Syncing new uploads from @${username}, ${when}.`
          : `Syncing every set from @${username}, ${when}. The first run applies their art to ${matchedTitles.toLocaleString('en-US')} ${matchedTitles === 1 ? 'title' : 'titles'}.`
      onSaved(message, saved.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const title = isCreator
    ? existing ? `Sync settings for @${username}` : `Sync @${username}`
    : `Sync ${setCount.toLocaleString('en-US')} ${setCount === 1 ? 'set' : 'sets'} from @${username}`
  const description = isCreator
    ? 'Applies this creator\'s art to your library on a schedule.'
    : `Applies these sets now and keeps them current on a schedule. New sets from @${username} are not included; use Sync on the creator for those.`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={save} loading={saving}>{existing ? 'Save' : 'Start syncing'}</Button>
        </>
      }
    >
      <div className={styles.syncForm}>
        <div className={styles.syncField}>
          <span id={scheduleLabelId} className={styles.syncLabel}>When it runs</span>
          <Select options={scheduleOptions} value={cronExpr} onChange={setCronExpr} ariaLabelledBy={scheduleLabelId} />
        </div>

        {isCreator && (
          <div className={styles.syncField}>
            <span id={startLabelId} className={styles.syncLabel}>Where it starts</span>
            <div role="radiogroup" aria-labelledby={startLabelId} className={styles.syncChoices}>
              {([
                ['new', since ? `New uploads since ${formatDate(since)}` : 'New uploads from today on',
                  `Nothing in your library changes now. Sets @${username} adds or updates ${since ? 'after that date' : 'from today'} apply on the schedule.`],
                ['everything', 'Everything now',
                  `The next run applies @${username}'s art to the ${matchedTitles.toLocaleString('en-US')} ${matchedTitles === 1 ? 'title' : 'titles'} in your library they cover, then keeps them current.`],
              ] as const).map(([value, title, desc]) => (
                <label key={value} className={`${styles.syncChoice} ${start === value ? styles.syncChoiceOn : ''}`}>
                  <input type="radio" className={styles.syncRadioInput} name={startName} checked={start === value} onChange={() => setStart(value)} />
                  <span className={styles.syncRadio} aria-hidden />
                  <span className={styles.syncChoiceText}>
                    <span className={styles.syncChoiceTitle}>{title}</span>
                    <span className={styles.syncChoiceDesc}>{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className={styles.syncField}>
          <span id={typesLabelId} className={styles.syncLabel}>Artwork types</span>
          <TypeToggles
            value={assetTypes ?? settingsTypes}
            onChange={next => setAssetTypes(artworkOverride(next, settingsTypes))}
            ariaLabelledBy={typesLabelId}
            ariaDescribedBy={typesDescId}
          />
          <span id={typesDescId} className={styles.syncChoiceDesc}>
            {assetTypes ? (
              <>
                Picked for this sync, so changes in Settings leave it alone.{' '}
                <button type="button" className={styles.inlineAction} onClick={() => setAssetTypes(undefined)}>Use Settings</button>
              </>
            ) : settingsTypes.length
              ? 'The types picked in Settings. The sync follows any change made there.'
              : 'Every type is switched off in Settings, so the sync applies nothing until you pick some here.'}
          </span>
        </div>

        <div className={styles.syncRow}>
          <span className={styles.syncRowText}>
            <span id={gapsLabelId} className={styles.syncLabel}>Only fill gaps</span>
            <span id={gapsDescId} className={styles.syncChoiceDesc}>
              Leaves any slot that other art already fills. Without it, this creator&apos;s art replaces what is there.
            </span>
          </span>
          <Switch checked={fillGaps} onChange={setFillGaps} ariaLabelledBy={gapsLabelId} ariaDescribedBy={gapsDescId} />
        </div>

        <div className={styles.syncNotes}>
          <Info size={14} className={styles.syncNotesIcon} aria-hidden />
          <ul className={styles.syncNotesList}>
            <li>A title&apos;s sets apply oldest first, so its newest set ends up on top{existing?.skipApplied !== false ? '; art already applied is skipped' : ''}.</li>
          </ul>
        </div>

        {error && <p className={styles.syncError} role="alert">Could not save the sync: {error}</p>}
      </div>
    </Modal>
  )
}
