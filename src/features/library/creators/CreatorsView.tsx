import { useEffect, useState } from 'react'
import { useCreatorPrefs } from '../../../utils/creatorPrefs'
import { appliedKey } from '../../../utils/appliedTracker'
import { errorMessage } from '../../../utils/errorMessage'
import { useCreatorsData } from './hooks/useCreatorsData'
import CreatorRail from './components/CreatorRail'
import CreatorCatalog from './components/CreatorCatalog'
import styles from './CreatorsView.module.css'

/** The creator last shown, so the view reopens on it. */
let lastCreator: string | null = null

/** The Creators view: followed creators beside the selected creator's catalog. */
export default function CreatorsView({ initialCreator }: { initialCreator: string | null })
{
  const { prefs, stateOf, setState } = useCreatorPrefs()
  const follows = prefs.mediuxFollows
  const { appliedIdx, setAppliedIdx, jobs, quickCron, types, setTypes, settingsTypes, coverage } = useCreatorsData()
  const [picked, setPicked] = useState<string | null>(initialCreator ?? lastCreator)
  const [prefsError, setPrefsError] = useState<string | null>(null)
  const active = picked ?? follows[0] ?? null

  useEffect(() => { if (initialCreator) setPicked(initialCreator) }, [initialCreator])
  useEffect(() => { lastCreator = active }, [active])

  function savePrefs(run: Promise<unknown>)
  {
    setPrefsError(null)
    run.catch((err: unknown) => setPrefsError(errorMessage(err)))
  }

  return (
    <div className={styles.creators}>
      <CreatorRail
        prefs={prefs}
        active={active}
        coverage={coverage}
        setPicked={setPicked}
        stateOf={stateOf}
        setState={setState}
        savePrefs={savePrefs}
        prefsError={prefsError}
        setPrefsError={setPrefsError}
      />
      <section className={styles.main} aria-label={active ? `@${active}` : 'Creator'}>
        {active ? (
          <CreatorCatalog
            key={active.toLowerCase()}
            username={active}
            creator={stateOf('mediux', active)}
            appliedIdx={appliedIdx}
            jobs={jobs}
            coverage={coverage}
            quickCron={quickCron}
            types={types}
            settingsTypes={settingsTypes}
            onTypesChange={setTypes}
            onCreatorChange={state =>
            {
              setPicked(active)
              savePrefs(setState('mediux', active, state))
            }}
            onApplied={(sKey, itemKey, title, year, urls) => setAppliedIdx(prev => ({
              setKeys: new Set(prev.setKeys).add(sKey),
              titles: new Set(prev.titles).add(appliedKey(title, year)),
              posterUrls: new Set([...prev.posterUrls, ...urls]),
              currentByItem: new Map(prev.currentByItem).set(itemKey, sKey),
              currentPosterUrls: new Set([...prev.currentPosterUrls, ...urls]),
            }))}
          />
        ) : (
          <div className={styles.emptyMain}>
            <h2 className={styles.emptyTitle}>Follow a creator to browse their catalog</h2>
            <p className={styles.emptyText}>
              Enter a MediUX username or profile link, such as <code>aloha_alona</code>. Their whole catalog appears here,
              matched against your library, and you can apply sets or keep them in sync. ThePosterDB creators open on their own site.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
