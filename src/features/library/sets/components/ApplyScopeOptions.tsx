import Checkbox from '../../../../components/ui/Checkbox'
import type { SetApplyScope } from '../../../../utils/posterGroups'
import styles from './ApplyScopeOptions.module.css'

interface ApplyScopeOptionsProps
{
  applyScope: SetApplyScope
  onApplyScopeChange: (patch: Partial<SetApplyScope>) => void
  /** How many of the set's movies are in the library. */
  collectionMovies?: number
  /** How many movies the set spans, including any not in the library. */
  collectionTotal?: number
  /** Whether the labels refer to a Plex Collection or a single movie. */
  scopeContext?: 'movie' | 'collection'
  hasCollectionArt?: boolean
  /** No Plex Collection matches the set's collection poster. */
  collectionMissing?: boolean
  /** Name for the movies radio group, unique per set. */
  scopeName: string
}

/** What a collection set applies to: its movies (this one or every one in the library) and the collection poster. */
export default function ApplyScopeOptions({
  applyScope, onApplyScopeChange, collectionMovies, collectionTotal, scopeContext, hasCollectionArt, collectionMissing, scopeName,
}: ApplyScopeOptionsProps)
{
  return (
    <div className={styles.scopeToggle} title="Choose whether to update movie posters, the Plex Collection poster, or both.">
      {(collectionMovies ?? 0) >= 1 && (
        <div className={styles.scopeBlock}>
          <Checkbox
            checked={applyScope.movies !== 'none'}
            onChange={() => onApplyScopeChange({
              movies: applyScope.movies === 'none'
                ? ((collectionMovies ?? 0) > 1 ? 'all' : 'this')
                : 'none',
            })}
            label={(collectionMovies ?? 0) === 1 && scopeContext !== 'collection' ? 'Apply to this title' : 'Apply to movies'}
          />
          {applyScope.movies !== 'none' && (collectionMovies ?? 0) > 1 && scopeContext !== 'collection' && (
            <div className={styles.scopeSubOptions}>
              <label className={styles.scopeRadio}>
                <input
                  type="radio"
                  name={scopeName}
                  checked={applyScope.movies === 'this'}
                  onChange={() => onApplyScopeChange({ movies: 'this' })}
                />
                This movie only
              </label>
              <label className={styles.scopeRadio}>
                <input
                  type="radio"
                  name={scopeName}
                  checked={applyScope.movies === 'all'}
                  onChange={() => onApplyScopeChange({ movies: 'all' })}
                />
                All {(collectionTotal && collectionTotal > (collectionMovies ?? 0))
                  ? `${collectionMovies} of ${collectionTotal} movies`
                  : `${collectionMovies} movies`} in library
              </label>
            </div>
          )}
          {applyScope.movies !== 'none' && (collectionMovies ?? 0) > 1 && scopeContext === 'collection' && (
            <div className={styles.scopeSubOptions}>
              <label className={styles.scopeRadio}>
                <input
                  type="radio"
                  name={scopeName}
                  checked={applyScope.movies === 'all'}
                  onChange={() => onApplyScopeChange({ movies: 'all' })}
                />
                All {(collectionTotal && collectionTotal > (collectionMovies ?? 0))
                  ? `${collectionMovies} of ${collectionTotal} movies`
                  : `${collectionMovies} movies`} in collection
              </label>
            </div>
          )}
        </div>
      )}
      {hasCollectionArt && (
        <div className={styles.scopeBlock}>
          <Checkbox
            checked={applyScope.collectionPoster}
            onChange={() => onApplyScopeChange({ collectionPoster: !applyScope.collectionPoster })}
            label="Apply collection poster"
            disabled={collectionMissing}
          />
          {collectionMissing && (
            <span className={styles.scopeNote}>No matching collection in Plex. Create it in Plex and refresh to apply this poster.</span>
          )}
        </div>
      )}
    </div>
  )
}
