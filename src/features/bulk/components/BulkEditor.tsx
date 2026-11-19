import { Save, Play } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import TypeToggles from '../../../components/ui/TypeToggles'
import { displayName } from '../bulkText'
import type { BulkFiles } from '../hooks/useBulkFiles'
import styles from './BulkEditor.module.css'


interface BulkEditorProps
{
  bulk: BulkFiles
  /** The open file. */
  active: string
  urlCount: number
}


/** The open bulk file: its name, the types to apply, Save and Run, and its URL list. */
export default function BulkEditor({ bulk, active, urlCount }: BulkEditorProps)
{
  const { content, setContent, isDirty, types, setTypes, runStatus, save, runFile } = bulk

  return (
    <>
      {/* editor header */}
      <div className={styles.editorHeader}>
        <div>
          <span className={styles.editorTitle}>{displayName(active)}</span>
          {isDirty && <span className={styles.dirtyDot} title="Unsaved changes" />}
        </div>
        <div className={styles.editorHeaderRight}>
          {urlCount > 0 && (
            <span className={styles.urlCount}>{urlCount} URL{urlCount !== 1 ? 's' : ''}</span>
          )}
          <TypeToggles value={types} onChange={setTypes} label="Artwork types to apply" disabled={runStatus === 'running'} />
          <Button
            variant="ghost"
            size="sm"
            icon={<Save size={13} />}
            onClick={save}
            disabled={!isDirty}
          >
            Save
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={runStatus === 'running' ? <Spinner size="xs" color="current" /> : <Play size={13} />}
            onClick={runFile}
            disabled={runStatus === 'running' || urlCount === 0}
          >
            {runStatus === 'running' ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {/* textarea */}
      <textarea
        className={styles.urlEditor}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={'https://theposterdb.com/set/12345\nhttps://mediux.pro/sets/67890\nhttps://mediux.pro/boxsets/3722\n…'}
        spellCheck={false}
        disabled={runStatus === 'running'}
      />
    </>
  )
}
