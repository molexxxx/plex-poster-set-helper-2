import { useId, type RefObject } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import type { JobDraft } from '../../hooks/useJobDraft'
import form from './form.module.css'
import styles from './LinksSection.module.css'

interface LinksSectionProps
{
  draft: JobDraft
  /** Focused when the form opens. */
  nameRef: RefObject<HTMLInputElement | null>
}

/** "What it applies": the job's name and its links, with the links that cannot be used and the one the last run could not read. */
export default function LinksSection({ draft, nameRef }: LinksSectionProps)
{
  const { name, setName, urls, setUrls, urlInfo, lastRun, failedLinks } = draft
  const ids = { name: useId(), urls: useId(), urlsHelp: useId() }
  return (
    <section className={form.formSection}>
      <h3 className={form.formHeading}>What it applies</h3>
      <div className={form.field}>
        <label htmlFor={ids.name} className={form.label}>Name</label>
        <input
          ref={nameRef}
          id={ids.name}
          className={form.input}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="For example, Nightly poster sync"
          spellCheck={false}
        />
      </div>

      <div className={form.field}>
        <label htmlFor={ids.urls} className={form.label}>Links</label>
        <p id={ids.urlsHelp} className={form.help}>
          One per line: MediUX set, boxset, show, or creator pages, and ThePosterDB set or poster pages.
        </p>
        <textarea
          id={ids.urls}
          aria-describedby={ids.urlsHelp}
          aria-invalid={urlInfo.unsupported.length > 0 || undefined}
          className={`${form.textarea} ${urlInfo.unsupported.length ? form.inputInvalid : ''}`}
          value={urls}
          onChange={e =>
          {
            const v = e.target.value
            setUrls(v)
            // Keep an auto-generated "Sync @user (N sets)" name counting the list; a custom name does not match.
            const setCount = v.split('\n').map(l => l.trim()).filter(u => /\/sets\/\d+/.test(u)).length
            setName(prev =>
            {
              const m = prev.match(/^(Sync @\S+) \(\d+ sets?\)$/)
              return m ? `${m[1]} (${setCount} ${setCount === 1 ? 'set' : 'sets'})` : prev
            })
          }}
          placeholder={'https://mediux.pro/sets/...\nhttps://mediux.pro/user/<creator>/sets\nhttps://theposterdb.com/set/...'}
          rows={5}
          spellCheck={false}
        />
        {urlInfo.urls.length > 0 && (
          <span className={form.help}>
            {urlInfo.urls.length} {urlInfo.urls.length === 1 ? 'link' : 'links'}
            {urlInfo.duplicates > 0 && ` · ${urlInfo.duplicates} duplicate${urlInfo.duplicates !== 1 ? 's' : ''} will be removed`}
          </span>
        )}
        {urlInfo.unsupported.length > 0 && (
          <p className={styles.fieldError} role="alert">
            <AlertCircle size={13} aria-hidden />
            <span>
              Only theposterdb.com and mediux.pro links work here:{' '}
              {urlInfo.unsupported.slice(0, 3).join(', ')}
              {urlInfo.unsupported.length > 3 && ` and ${urlInfo.unsupported.length - 3} more`}
            </span>
          </p>
        )}
        {failedLinks.length > 0 && (
          <p className={styles.fieldWarning}>
            <AlertTriangle size={13} aria-hidden />
            <span>The last run could not read {lastRun!.error}</span>
          </p>
        )}
      </div>
    </section>
  )
}
