import { useState } from 'react'
import { ListPlus, ExternalLink } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { useUpdater } from '../../updater/UpdaterContext'
import { parseUrlList } from '../queueText'
import styles from './UrlInput.module.css'


/** Artwork sources users paste links from - opened in the browser on request. */
const SOURCES = [
  { label: 'ThePosterDB', url: 'https://theposterdb.com' },
  { label: 'MediUX',      url: 'https://mediux.pro' },
] as const


interface UrlInputProps {
  /** A run is in progress, so nothing can be added. */
  disabled: boolean
  /** Receives the URLs in the box when they are added to the queue. */
  onAdd: (urls: string[]) => void
}


/** The box URLs are typed or pasted into, with links to the artwork sites and Add to Queue. */
export default function UrlInput({ disabled, onAdd }: UrlInputProps) {
  const { env } = useUpdater()
  const [inputValue, setInputValue] = useState('')

  function handleAdd() {
    const urls = parseUrlList(inputValue)
    if (urls.length) {
      onAdd(urls)
      setInputValue('')
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleAdd()
    }
  }

  /**
   * Open an artwork source in the browser. In the desktop app the click is
   * routed through the OS browser via openExternal (an in-app <a> would spawn a
   * blank Electron window). The headless Docker build is viewed in a real
   * browser where openExternal is a no-op, so there we let the anchor's native
   * target="_blank" open a new tab instead.
   */
  function openSource(e: React.MouseEvent<HTMLAnchorElement>, url: string) {
    if (!env?.container) {
      e.preventDefault()
      window.api.app.openExternal(url)
    }
  }

  return (
    <div className={styles.inputSection}>
      <textarea
        className={styles.urlInput}
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={'https://theposterdb.com/set/12345\nhttps://mediux.pro/sets/67890\nhttps://mediux.pro/boxsets/3722\n…'}
        rows={4}
        disabled={disabled}
        spellCheck={false}
      />
      <div className={styles.inputFooter}>
        <div className={styles.footerLeft}>
          <p className={styles.inputHint}>
            <kbd className={styles.kbd}>Ctrl</kbd><kbd className={styles.kbd}>Enter</kbd> to add
          </p>
          <span className={styles.sources}>
            <span className={styles.sourcesLabel}>Browse</span>
            {SOURCES.map(s => (
              <a
                key={s.url}
                className={styles.sourceLink}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => openSource(e, s.url)}
              >
                {s.label}
                <ExternalLink size={11} />
              </a>
            ))}
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<ListPlus size={14} />}
          onClick={handleAdd}
          disabled={disabled || !inputValue.trim()}
        >
          Add to Queue
        </Button>
      </div>
    </div>
  )
}
