import { CheckCircle2, Download, FolderOpen, Trash2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import Select from '../../../components/ui/Select'
import { DEFAULT_LOG_RETENTION_DAYS } from '../../../../electron/services/logFormat'
import type { AppConfig } from '../../../../electron/ipc/types'
import type { LogsAndCaches } from '../hooks/useLogsAndCaches'
import { RETENTION_OPTIONS } from '../settingsOptions'
import { logRetentionText } from '../settingsText'
import Block from './Block'
import Row from './Row'
import controls from './controls.module.css'
import rowStyles from './settingsRows.module.css'

interface LogsBlockProps
{
  cfg: AppConfig
  isWeb: boolean
  maintenance: LogsAndCaches
  /** Opens the clear-logs or clear-cached-data confirmation. */
  setConfirm: (dialog: 'logs' | 'caches') => void
}

/** Logs and cached data: how long logs are kept, the log files, and clearing cached data. */
export default function LogsBlock({ cfg, isWeb, maintenance, setConfirm }: LogsBlockProps)
{
  const { logStatus, logsCleared, logsSaved, logFilesNote, cachesCleared, clearingCaches, setLogRetention, saveLogCopy } = maintenance
  return (
    <Block title="Logs and cached data" anchor="logs">
      <Row label="Keep logs for" description={logRetentionText(logStatus)}>
        {({ labelId, descId }) => (
          <div className={controls.selectWrap} aria-describedby={descId}>
            <Select
              options={RETENTION_OPTIONS}
              value={String(cfg.logRetentionDays ?? DEFAULT_LOG_RETENTION_DAYS)}
              onChange={v => void setLogRetention(Number(v))}
              ariaLabelledBy={labelId}
            />
          </div>
        )}
      </Row>
      <Row
        label="Log files"
        description={logFilesNote
          ? <span className={logFilesNote.error ? rowStyles.rowError : undefined}>{logFilesNote.text}</span>
          : isWeb
            ? 'Download a copy to attach to a bug report, or clear every saved file.'
            : 'Open the folder, save a copy to attach to a bug report, or clear every saved file.'}
      >
        {!isWeb && (
          <Button variant="secondary" size="sm" icon={<FolderOpen size={13} />} onClick={() => void window.api.app.openLogFolder()}>
            Open folder
          </Button>
        )}
        <Button variant="secondary" size="sm" icon={logsSaved ? <CheckCircle2 size={13} /> : <Download size={13} />} onClick={() => void saveLogCopy()}>
          {logsSaved ? 'Saved' : isWeb ? 'Download' : 'Save a copy…'}
        </Button>
        <Button variant="destructive" size="sm" icon={logsCleared ? <CheckCircle2 size={13} /> : <Trash2 size={13} />} onClick={() => setConfirm('logs')}>
          {logsCleared ? 'Cleared' : 'Clear logs'}
        </Button>
      </Row>
      <Row
        label="Cached data"
        description="Creator catalogs, series statuses, and library listings are kept so they load instantly. Clear them if something looks out of date."
      >
        <Button
          variant="destructive" size="sm"
          icon={cachesCleared ? <CheckCircle2 size={13} /> : clearingCaches ? <Spinner size="xs" color="current" /> : <Trash2 size={13} />}
          onClick={() => setConfirm('caches')}
          disabled={clearingCaches}
        >
          {cachesCleared ? 'Cleared' : 'Clear cached data'}
        </Button>
      </Row>
    </Block>
  )
}
