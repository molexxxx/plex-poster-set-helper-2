import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, Save, ArrowRight, Info, KeyRound } from 'lucide-react'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { useAppContext } from '../../app/AppContext'
import { useNavStore } from '../../app/navStore'
import styles from './MappingsPage.module.css'


interface MappingRow {
  id: string
  plexTitle: string
  scraperTitle: string
}


/** Title-mappings editor: maps scraped titles to the exact Plex titles. */
export default function MappingsPage() {
  const [rows, setRows]       = useState<MappingRow[]>([])
  const [saved, setSaved]     = useState<MappingRow[]>([])
  const [saving, setSaving]   = useState(false)
  const newPlexRef = useRef<HTMLInputElement>(null)
  const { navigate } = useAppContext()
  const goSettings = useNavStore(s => s.goSettings)

  const isDirty = JSON.stringify(rows) !== JSON.stringify(saved)

  /** Jumps to the Settings TMDB key section, which fixes most matching issues. */
  function openTmdbSettings() {
    goSettings('tmdb')
    navigate('settings')
  }


  useEffect(() => {
    window.api.config.get().then(cfg => {
      const existing = Object.entries(cfg.titleMappings ?? {}).map(([k, v]) => ({
        id: crypto.randomUUID(),
        plexTitle: k,
        scraperTitle: v as string,
      }))
      setRows(existing)
      setSaved(existing)
    })
  }, [])


  function addRow() {
    const row: MappingRow = { id: crypto.randomUUID(), plexTitle: '', scraperTitle: '' }
    setRows(r => [...r, row])
    // focus the new Plex title input after render
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(`.${styles.cellInput}`)
      inputs[inputs.length - 2]?.focus()
    }, 30)
  }

  function updateRow(id: string, field: 'plexTitle' | 'scraperTitle', value: string) {
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: value } : row))
  }

  function deleteRow(id: string) {
    setRows(r => r.filter(row => row.id !== id))
  }


  async function save() {
    setSaving(true)
    const titleMappings = Object.fromEntries(
      rows
        .filter(r => r.plexTitle.trim() && r.scraperTitle.trim())
        .map(r => [r.plexTitle.trim(), r.scraperTitle.trim()])
    )
    await window.api.config.set({ titleMappings })
    setSaved(rows)
    setSaving(false)
  }


  return (
    <div className={styles.page}>

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className="page-title">Title Mappings</h1>
          <p className="page-subtitle">
            Map Plex library titles to alternative names used by PosterDB or MediUX when automatic matching fails.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus size={13} />}
            onClick={addRow}
          >
            Add Row
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Save size={13} />}
            onClick={save}
            disabled={!isDirty || saving}
            loading={saving}
          >
            Save
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <div className={styles.infoBanner}>
        <Info size={13} />
        <span>
          The <strong>Plex Title</strong> must match exactly as it appears in your Plex library.
          The <strong>Scraper Title</strong> is what the tool searches for on PosterDB / MediUX.
        </span>
      </div>

      {/* TMDB tip - most mapping issues disappear once matching is ID-based */}
      <div className={styles.tipBanner}>
        <KeyRound size={13} />
        <span>
          Most mappings become unnecessary with a free <strong>TMDB API key</strong>: the app then
          matches your library by ID instead of by title, so renamed and subtitled titles resolve
          automatically.{' '}
          <button className={styles.tipLink} onClick={openTmdbSettings}>Add a TMDB key in Settings</button>.
        </span>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<ArrowRight size={22} />}
          title="No mappings yet"
          description="Add a row to override how a Plex title is matched against poster sources."
          action={
            <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={addRow}>
              Add First Mapping
            </Button>
          }
        />
      ) : (
        <div className={styles.tableWrap}>
          <div className={styles.tableHeader}>
            <span>Plex Title</span>
            <span />
            <span>Scraper Title</span>
            <span />
          </div>
          <div className={styles.tableBody}>
            <AnimatePresence initial={false}>
              {rows.map((row, i) => (
                <motion.div
                  key={row.id}
                  className={styles.tableRow}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.16 }}
                  layout
                >
                  <input
                    ref={i === rows.length - 1 ? newPlexRef : undefined}
                    className={styles.cellInput}
                    value={row.plexTitle}
                    onChange={e => updateRow(row.id, 'plexTitle', e.target.value)}
                    placeholder="e.g. Avengers: Endgame"
                    spellCheck={false}
                  />
                  <span className={styles.arrow}><ArrowRight size={13} /></span>
                  <input
                    className={styles.cellInput}
                    value={row.scraperTitle}
                    onChange={e => updateRow(row.id, 'scraperTitle', e.target.value)}
                    placeholder="e.g. Avengers Endgame"
                    spellCheck={false}
                  />
                  <button
                    className={styles.deleteBtn}
                    onClick={() => deleteRow(row.id)}
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {isDirty && (
        <motion.p
          className={styles.unsavedNote}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          You have unsaved changes
        </motion.p>
      )}
    </div>
  )
}
