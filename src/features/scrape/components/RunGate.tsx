import { motion } from 'framer-motion'
import { Zap } from 'lucide-react'
import Button from '../../../components/ui/Button'
import styles from './RunGate.module.css'


interface RunGateProps
{
  idleCount: number
  onRun: () => void
}


/** The banner saying how many queued URLs are ready to scrape, with Run Queue. */
export default function RunGate({ idleCount, onRun }: RunGateProps)
{
  return (
    <motion.div
      className={styles.runGate}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <div className={styles.runGateInfo}>
        <span className={styles.runGateDot} aria-hidden="true" />
        <span>
          <strong>{idleCount}</strong> URL{idleCount !== 1 ? 's' : ''} queued and ready, click Run to begin scraping
        </span>
      </div>
      <Button variant="primary" size="sm" icon={<Zap size={13} />} onClick={onRun}>
        Run Queue
      </Button>
    </motion.div>
  )
}
