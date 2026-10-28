import library from '../assets/screens/library.jpg?ladder'
import creators from '../assets/screens/creators.jpg?ladder'
import collections from '../assets/screens/collections.jpg?ladder'
import palette from '../assets/screens/palette.jpg?ladder'
import scheduler from '../assets/screens/scheduler.jpg?ladder'
import applied from '../assets/screens/import.jpg?ladder'
import reset from '../assets/screens/reset.jpg?ladder'
import settings from '../assets/screens/settings.jpg?ladder'
import type { Picture } from '../components/Shot'

export interface Frame
{
  id: string
  label: string
  shot: Picture
  alt: string
  caption: string
  doc: string
  /** What the screen does, printed on the film edge under the frame. Avoid counts that change as data loads. */
  edge: string
}

/** The film strip: one real screen per feature, in the order a visitor meets them. */
export const frames: Frame[] = [
  {
    id: 'library',
    label: 'Library Browser',
    shot: library,
    alt: 'Library Browser with the sets panel open for Lucifer, listing MediUX and ThePosterDB sets with download counts',
    caption: 'Pick any title and its MediUX and ThePosterDB sets line up side by side, most downloaded first. Apply a whole set or a single image.',
    doc: 'library-browser',
    edge: 'MediUX + TPDB ▸ Most downloaded first',
  },
  {
    id: 'creators',
    label: 'Creators',
    shot: creators,
    alt: "Creators tab showing a followed MediUX creator's sets and which titles are in the library",
    caption: "Follow or hide creators on either site, and sync a MediUX creator's whole catalog with one click.",
    doc: 'library-browser',
    edge: 'Follow ▸ Hide ▸ Sync a whole catalog',
  },
  {
    id: 'collections',
    label: 'Collections',
    shot: collections,
    alt: 'Collections tab with the sets panel open for a movie collection, offering to apply art to the collection and its movies',
    caption: "Collections have their own tab. One set can dress the collection poster and the collection's movies in your library at once.",
    doc: 'library-browser',
    edge: 'Collection poster ▸ Apply to movies',
  },
  {
    id: 'palette',
    label: 'Command palette',
    shot: palette,
    alt: 'Command palette open over the library, listing pages and quick actions',
    caption: 'Press Ctrl+F to jump to any page, setting, schedule, or creator, or to paste a link.',
    doc: 'library-browser',
    edge: 'Ctrl+F ▸ Pages ▸ Quick actions',
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    shot: scheduler,
    alt: 'Job editor set to a weekly schedule on Monday at 09:00, with a preview of the next three runs',
    caption: 'Jobs re-apply sets and creators on any schedule, so new title cards and uploads arrive on their own.',
    doc: 'keeping-posters-up-to-date',
    edge: 'Weekly ▸ Mon 09:00 ▸ Next 3 runs shown',
  },
  {
    id: 'import',
    label: 'Manual Import',
    shot: applied,
    alt: 'Manual Import with episode title cards already in the library marked Applied',
    caption: "Paste MediUX or ThePosterDB links. Art already in your library is marked, so you upload only what's new.",
    doc: 'supported-links',
    edge: 'Season 4 title cards ▸ Applied marked',
  },
  {
    id: 'reset',
    label: 'Reset Posters',
    shot: reset,
    alt: 'Reset Posters page listing applied art by title and source',
    caption: "Every poster you apply is logged with its source, and any title can go back to Plex's original art.",
    doc: 'how-matching-works',
    edge: 'Logged by source ▸ Revert to Plex art',
  },
  {
    id: 'sign-in',
    label: 'Sign-in',
    shot: settings,
    alt: 'Settings page with the Plex account connected and libraries detected',
    caption: 'Sign in with Plex in your browser. Your server and libraries are found for you, with no tokens or config files.',
    doc: 'first-run',
    edge: 'Plex account ▸ Connected',
  },
]
