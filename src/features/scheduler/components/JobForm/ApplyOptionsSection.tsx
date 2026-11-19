import { useId } from 'react'
import Switch from '../../../../components/ui/Switch'
import TypeToggles from '../../../../components/ui/TypeToggles'
import type { ArtworkType } from '../../../../../electron/ipc/types'
import { artworkOverride } from '../../../../../electron/services/schedule/artworkTypes'
import type { JobDraft } from '../../hooks/useJobDraft'
import form from './form.module.css'
import styles from './ApplyOptionsSection.module.css'

/** "How it applies": the artwork types, which follow Settings until picked for the job, and the new-art-only and fill-gaps switches. */
export default function ApplyOptionsSection({ draft, settingsTypes }: { draft: JobDraft; settingsTypes: ArtworkType[] })
{
  const { assetTypes, setAssetTypes, skipApplied, setSkipApplied, fillGaps, setFillGaps } = draft
  const ids = { types: useId(), typesHelp: useId() }
  return (
    <section className={form.formSection}>
      <h3 className={form.formHeading}>How it applies</h3>
      <div className={form.field}>
        <span id={ids.types} className={form.label}>Artwork types</span>
        <TypeToggles
          value={assetTypes ?? settingsTypes}
          onChange={next => setAssetTypes(artworkOverride(next, settingsTypes))}
          ariaLabelledBy={ids.types}
          ariaDescribedBy={ids.typesHelp}
        />
        <span id={ids.typesHelp} className={form.help}>
          {assetTypes ? (
            <>
              Picked for this job, so changes in Settings leave it alone.{' '}
              <button type="button" className={styles.helpLink} onClick={() => setAssetTypes(undefined)}>Use Settings</button>
            </>
          ) : 'Starts from Settings and follows any change made there. Pick different types to keep this job on its own.'}
        </span>
      </div>
      <Switch
        label="Only apply new artwork"
        description="Skips posters already applied to an item, so Plex does not collect duplicate copies."
        checked={skipApplied}
        onChange={setSkipApplied}
      />
      <Switch
        label="Only fill gaps"
        description="Leaves any poster, season, or episode that other art already covers. Use it for a backup creator."
        checked={fillGaps}
        onChange={setFillGaps}
      />
    </section>
  )
}
