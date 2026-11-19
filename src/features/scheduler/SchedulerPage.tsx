import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, X, Server } from 'lucide-react'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import type { ScheduledJob } from '../../../electron/ipc/types'
import { useNavStore } from '../../app/navStore'
import { useAppContext } from '../../app/AppContext'
import { useNow } from './hooks/useNow'
import { useSettingsTypes } from './hooks/useSettingsTypes'
import { useSchedulerJobs } from './hooks/useSchedulerJobs'
import JobList from './components/JobList'
import JobDetail from './components/JobDetail'
import EmptyJobs from './components/EmptyJobs'
import JobForm from './components/JobForm/JobForm'
import listStyles from './components/JobList.module.css'
import shared from './schedulerShared.module.css'
import styles from './SchedulerPage.module.css'
/** Scheduler: a queue of jobs that apply MediUX and ThePosterDB art to Plex on a schedule, with the selected job beside it. */
export default function SchedulerPage()
{
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [editing,     setEditing]     = useState<ScheduledJob | 'new' | null>(null)
  const [deleting,    setDeleting]    = useState<ScheduledJob | null>(null)
  const { jobs, starting, engine, actionError, setActionError, announcement, loaded, attempt, runNow, moveJob } = useSchedulerJobs()
  const now = useNow()
  const settingsTypes = useSettingsTypes()
  const { navigate } = useAppContext()
  const goLibrary = useNavStore(s => s.goLibrary)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = jobs.find(j => j.id === selectedId) ?? jobs[0] ?? null

  /** Selects a job and brings it into view in the list. */
  const reveal = useCallback((id: string) =>
  {
    setSelectedId(id)
    setTimeout(() =>
    {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-job-id="${id}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'nearest' })
      el.focus()
      el.classList.add(listStyles.rowPulse)
      setTimeout(() => el.classList.remove(listStyles.rowPulse), 1600)
    }, 60)
  }, [])

  // Command-palette deep link: select the requested job.
  const schedulerJobId = useNavStore(s => s.schedulerJobId)
  const clearScheduler  = useNavStore(s => s.clearScheduler)
  useEffect(() =>
  {
    if (!schedulerJobId || jobs.length === 0) return
    const id = schedulerJobId
    const t = setTimeout(() => { reveal(id); clearScheduler() }, 60)
    return () => clearTimeout(t)
  }, [schedulerJobId, jobs.length, clearScheduler, reveal])

  async function saveJob(job: ScheduledJob, runAfterSave: boolean)
  {
    const saved = await window.api.scheduler.save(job)
    setEditing(null)
    setSelectedId(saved.id)
    if (runAfterSave) void runNow(saved.id)
  }

  function confirmDelete()
  {
    const job = deleting
    setDeleting(null)
    if (job) void attempt(() => window.api.scheduler.delete(job.id))
  }

  const closeEditor = useCallback(() => setEditing(null), [])
  const selectedIndex = selected ? jobs.findIndex(j => j.id === selected.id) : -1

  const notices = (
    <>
      {engine.external && (
        <div className={shared.infoNotice}>
          <Server size={14} aria-hidden />
          <span>A 24/7 scheduler elsewhere runs these jobs, even when this app is closed. Changes here reach it automatically.</span>
        </div>
      )}

      {actionError && (
        <div className={shared.errorNotice} role="alert">
          <AlertCircle size={14} aria-hidden />
          <span>{actionError}</span>
          <Button variant="ghost" size="sm" icon={<X size={13} />} aria-label="Dismiss" onClick={() => setActionError(null)} />
        </div>
      )}
    </>
  )

  return (
    <div className={styles.page}>
      {loaded && jobs.length === 0 && (
        <div className={shared.emptyPage}>
          <header>
            <h1 className="page-title">Scheduler</h1>
            <p className="page-subtitle">Applies new art from MediUX and ThePosterDB to Plex on a schedule.</p>
          </header>
          {notices}
          <EmptyJobs
            onNew={() => setEditing('new')}
            onOpenCreators={() => { goLibrary({ creators: true }); navigate('library') }}
            onOpenLibrary={() => navigate('library')}
          />
        </div>
      )}

      {jobs.length > 0 && (
        <div className={styles.layout}>
          <JobList
            jobs={jobs}
            selected={selected}
            starting={starting}
            now={now}
            listRef={listRef}
            setSelectedId={setSelectedId}
            setEditing={setEditing}
            reveal={reveal}
          />
          <div className={styles.main}>
            {notices}

            {selected && (
              <JobDetail
                key={selected.id}
                job={selected}
                settingsTypes={settingsTypes}
                now={now}
                starting={starting.has(selected.id)}
                canMoveUp={selectedIndex > 0}
                canMoveDown={selectedIndex < jobs.length - 1}
                canStop={!engine.external}
                onEdit={() => setEditing(selected)}
                onDelete={() => setDeleting(selected)}
                onToggle={enabled => void attempt(() => window.api.scheduler.save({ ...selected, enabled }))}
                onRunNow={() => void runNow(selected.id)}
                onStop={() => void attempt(() => window.api.scheduler.stop(selected.id))}
                onMove={delta => moveJob(selected.id, delta)}
              />
            )}
          </div>
        </div>
      )}

      {editing !== null && (
        <JobForm
          initial={editing === 'new' ? undefined : editing}
          settingsTypes={settingsTypes}
          onSave={saveJob}
          onClose={closeEditor}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ''}"?`}
        body="The job and its run history are removed. Art it already applied stays in Plex."
        confirmLabel="Delete job"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <p className={shared.srOnly} aria-live="polite">{announcement}</p>
    </div>
  )
}
