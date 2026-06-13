import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ScrollText, Search } from 'lucide-react'
import type { NavTab } from '../../app/App'
import { NAV_ENTRIES } from './navModel'
import styles from './FloatingDock.module.css'

interface DockButtonProps {
  icon: React.ReactNode
  label: string
  /** This item owns the current section/state (amber glyph, lit backplate, dot). */
  active?: boolean
  onClick: () => void
}

/** A fixed dock tile. Hover/active states are pure fades - no movement, scale, or sliding. */
function DockButton({ icon, label, active, onClick }: DockButtonProps) {
  const [showLabel, setShowLabel] = useState(false)
  return (
    <button
      type="button"
      className={`${styles.item} ${active ? styles.itemActive : ''}`}
      onClick={onClick}
      onMouseEnter={() => setShowLabel(true)}
      onMouseLeave={() => setShowLabel(false)}
      aria-label={label}
    >
      <AnimatePresence>
        {showLabel && (
          <motion.span
            className={styles.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
      <span className={styles.iconWrap}>{icon}</span>
      {active && <span className={styles.dot} />}
    </button>
  )
}

interface Props {
  activeTab: NavTab
  logOpen: boolean
  onNavigate: (tab: NavTab) => void
  onToggleLogs: () => void
  onOpenPalette: () => void
  isMac: boolean
}

/** Floating, glassy dock pinned bottom-center. Condenses while the log drawer is open. */
export default function FloatingDock({ activeTab, logOpen, onNavigate, onToggleLogs, onOpenPalette, isMac }: Props) {
  const compact = logOpen
  const iconSize = compact ? 17 : 20

  const mainEntries = NAV_ENTRIES.filter(e => e.id !== 'settings')
  const settings = NAV_ENTRIES.find(e => e.id === 'settings')!

  return (
    <div className={styles.wrap}>
      <div className={`${styles.dock} ${compact ? styles.dockCompact : ''}`}>
        {mainEntries.map(e => (
          <DockButton
            key={e.id}
            icon={<e.Icon size={iconSize} />}
            label={e.label}
            active={activeTab === e.id}
            onClick={() => onNavigate(e.id)}
          />
        ))}

        <span className={styles.divider} />

        <DockButton
          icon={<ScrollText size={iconSize} />}
          label="Logs"
          active={logOpen}
          onClick={onToggleLogs}
        />
        <DockButton
          icon={<settings.Icon size={iconSize} />}
          label={settings.label}
          active={activeTab === 'settings'}
          onClick={() => onNavigate('settings')}
        />

        <span className={styles.divider} />

        <button type="button" className={styles.cmdBtn} onClick={onOpenPalette} aria-label="Open command palette">
          <Search size={14} />
          {!compact && <span className={styles.kbd}>{isMac ? '⌘' : 'Ctrl'} F</span>}
        </button>
      </div>
    </div>
  )
}
