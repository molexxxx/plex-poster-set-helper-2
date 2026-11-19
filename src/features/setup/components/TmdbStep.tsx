import { useState } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, ExternalLink, ArrowRight } from 'lucide-react'
import Button from '../../../components/ui/Button'
import styles from './TmdbStep.module.css'

interface TmdbStepProps
{
  onComplete: () => void
}

/** The optional TMDB API key step at the end of first-run setup. */
export default function TmdbStep({ onComplete }: TmdbStepProps)
{
  const [tmdbKey, setTmdbKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)

  // Saves the pasted key (if any) and dismisses onboarding. Skipping passes an
  // empty key through - matching simply falls back to title and year.
  async function finishTmdbStep(save: boolean)
  {
    const key = tmdbKey.trim()
    if (save && key)
    {
      setSavingKey(true)
      try
      {
        await window.api.config.set({ tmdbApiKey: key })
      }
      finally
      {
        setSavingKey(false)
      }
    }
    onComplete()
  }

  return (
    <motion.div className={styles.tmdbBlock} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className={styles.tmdbHead}>
        <KeyRound size={16} className={styles.tmdbIcon} />
        <span className={styles.tmdbTitle}>Add a TMDB API key (optional)</span>
      </div>
      <p className={styles.tmdbDesc}>
        Recommended: a free TMDB key lets the app match your library by ID instead of guessing
        by title and year, which fixes most matching and title-mapping issues. You can always
        add or change it later in Settings.
      </p>
      <input
        className={styles.tmdbInput}
        type="password"
        value={tmdbKey}
        onChange={e => setTmdbKey(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void finishTmdbStep(true) }}
        placeholder="Paste TMDB v3 API key…"
        spellCheck={false}
        autoFocus
      />
      <button
        className={styles.tmdbLink}
        onClick={() => window.api.app.openExternal('https://www.themoviedb.org/settings/api')}
      >
        <ExternalLink size={12} /> Get a free key at themoviedb.org
      </button>
      <div className={styles.tmdbActions}>
        <Button variant="ghost" size="sm" onClick={() => void finishTmdbStep(false)} disabled={savingKey}>
          Skip for now
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={<ArrowRight size={13} />}
          onClick={() => void finishTmdbStep(true)}
          loading={savingKey}
          disabled={savingKey}
        >
          {tmdbKey.trim() ? 'Save & continue' : 'Continue'}
        </Button>
      </div>
    </motion.div>
  )
}
