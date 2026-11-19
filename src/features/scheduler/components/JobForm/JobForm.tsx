import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, X, Save, AlertCircle } from 'lucide-react'
import Button from '../../../../components/ui/Button'
import ConfirmDialog from '../../../../components/ui/ConfirmDialog'
import type { ArtworkType, ScheduledJob } from '../../../../../electron/ipc/types'
import { uuid } from '../../../../utils/uuid'
import { errorMessage } from '../../../../utils/errorMessage'
import { useJobDraft } from '../../hooks/useJobDraft'
import { trapTab } from './trapTab'
import LinksSection from './LinksSection'
import ScheduleSection from './ScheduleSection'
import ApplyOptionsSection from './ApplyOptionsSection'
import styles from './JobForm.module.css'
interface JobFormProps {
  initial?: ScheduledJob
  settingsTypes: ArtworkType[]
  onSave:  (job: ScheduledJob, runAfterSave: boolean) => Promise<void>
  onClose: () => void
}

/** Dialog for creating or editing a scheduled job. */
export default function JobForm({ initial, settingsTypes, onSave, onClose }: JobFormProps) {
  const draft = useJobDraft(initial)
  const { name, urlInfo, cronExpr, enabled, skipApplied, fillGaps, assetTypes, valid, dirty } = draft
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<Element | null>(null)
  const confirmOpenRef = useRef(false)
  useEffect(() => { confirmOpenRef.current = confirmDiscard }, [confirmDiscard])

  useEffect(() => {
    openerRef.current = document.activeElement
    nameRef.current?.focus()
    return () => {
      const opener = openerRef.current
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])

  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }, [dirty, onClose])

  async function submit(runAfterSave: boolean) {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...initial,
        id: initial?.id ?? uuid(),
        name: name.trim(),
        urls: urlInfo.urls,
        cronExpr,
        enabled,
        skipApplied,
        fillGaps,
        assetTypes,
      }, runAfterSave)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const submitRef = useRef(submit)
  useEffect(() => { submitRef.current = submit })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmOpenRef.current) return
      if (e.key === 'Escape') {
        if (dialogRef.current?.querySelector('[role="listbox"]')) return
        e.preventDefault()
        requestClose()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        void submitRef.current(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  const downOnOverlay = useRef(false)

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={e => { downOnOverlay.current = e.target === e.currentTarget }}
      onClick={e => { if (downOnOverlay.current && e.target === e.currentTarget) requestClose() }}
    >
      <div
        ref={dialogRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={e => trapTab(e, dialogRef.current)}
      >
        <div className={styles.drawerHeader}>
          <h2 id={titleId} className={styles.drawerTitle}>{initial ? 'Edit job' : 'New job'}</h2>
          <Button variant="ghost" size="sm" icon={<X size={15} />} aria-label="Close" onClick={requestClose} />
        </div>

        <div className={styles.drawerBody}>
          <LinksSection draft={draft} nameRef={nameRef} />

          <ScheduleSection draft={draft} />

          <ApplyOptionsSection draft={draft} settingsTypes={settingsTypes} />
        </div>

        <div className={styles.drawerFooter}>
          {error && (
            <p className={styles.footerError} role="alert">
              <AlertCircle size={13} aria-hidden />
              <span>{error}</span>
            </p>
          )}
          <div className={styles.footerActions}>
            <Button variant="ghost" size="sm" onClick={requestClose}>Cancel</Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Play size={13} />}
              onClick={() => submit(true)}
              disabled={!valid || saving}
              title="Save, then run the job once now"
            >
              Save and run
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={13} />}
              onClick={() => submit(false)}
              disabled={!valid}
              loading={saving}
              title="Save (Ctrl+Enter)"
            >
              {initial ? 'Save changes' : 'Create job'}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        body="The changes you made to this job are not saved yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>,
    document.body,
  )
}
