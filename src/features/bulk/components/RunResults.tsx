import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import Spinner from '../../../components/ui/Spinner'
import { resultNote } from '../bulkText'
import type { RunResult } from '../hooks/useBulkFiles'
import styles from './RunResults.module.css'


interface RunResultsProps
{
  results: RunResult[]
  running: boolean
  urlCount: number
}


/** A bulk run's progress, with a line for each URL processed. */
export default function RunResults({ results, running, urlCount }: RunResultsProps)
{
  const totalUploaded = results.reduce((n, r) => n + r.uploadedCount, 0)
  const errorCount    = results.filter(r => r.status === 'error').length

  return (
    <motion.div
      className={styles.results}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className={styles.resultsSummary}>
        {running && <Spinner size="xs" />}
        <span>
          {results.length}/{urlCount} processed
          {totalUploaded > 0 && ` · ${totalUploaded} uploaded`}
          {errorCount > 0 && (
            <span className={styles.errorCount}> · {errorCount} error{errorCount !== 1 ? 's' : ''}</span>
          )}
        </span>
      </div>
      <div className={styles.resultList}>
        {results.map((r, i) => (
          <div key={i} className={`${styles.resultRow} ${r.status === 'error' ? styles.resultError : ''}`}>
            <span className={styles.resultIcon}>
              {r.status === 'error' ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
            </span>
            <span className={styles.resultUrl}>{r.url.replace(/https?:\/\//, '')}</span>
            <span className={styles.resultMeta}>
              {resultNote(r)}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
