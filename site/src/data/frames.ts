import libraryFull from '../assets/library-browser.jpg'
import libraryThumb from '../../../.github/assets/gallery/thumbs/library-browser.jpg'
import creatorsFull from '../../../.github/assets/gallery/1-creators-browser.jpg'
import creatorsThumb from '../../../.github/assets/gallery/thumbs/1-creators-browser.jpg'
import schedulerEditor from '../assets/scheduler-editor.jpg'
import appliedFull from '../../../.github/assets/gallery/6-manual-scrape-titles.jpg'
import appliedThumb from '../../../.github/assets/gallery/thumbs/6-manual-scrape-titles.jpg'
import resetFull from '../../../.github/assets/gallery/7-reset-posters.jpg'
import settingsFull from '../../../.github/assets/gallery/8-settings-top.jpg'

export interface Frame
{
  id: string
  label: string
  full: string
  thumb: string
  alt: string
  caption: string
  doc: string
  /** What the screen itself shows, printed on the film edge under the frame. */
  edge: string
  /** Crop for screens whose content sits in one part of the capture. */
  focus?: { origin: string; scale: number }
}

/** The reel: one real screen per capability, in the order a visitor meets them. */
export const frames: Frame[] = [
  {
    id: 'library',
    label: 'Library Browser',
    full: libraryFull,
    thumb: libraryThumb,
    alt: 'Library Browser with the sets panel open for Lucifer, listing MediUX and ThePosterDB sets with download counts',
    caption: "Pick any title and its MediUX and ThePosterDB sets line up side by side, most downloaded first. Apply a whole set or a single image.",
    doc: 'library-browser',
    edge: 'Lucifer ▸ 59 sets ▸ MediUX 11 ▸ TPDB 48',
  },
  {
    id: 'creators',
    label: 'Creators',
    full: creatorsFull,
    thumb: creatorsThumb,
    alt: "Creators tab showing a followed MediUX creator's sets and which titles are in the library",
    caption: "Follow or hide creators on either site, and sync a MediUX creator's whole catalog with one click.",
    doc: 'library-browser',
    edge: 'Following ▸ 24 sets ▸ 6 in library',
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    full: schedulerEditor,
    thumb: schedulerEditor,
    alt: 'Job editor set to a weekly schedule on Monday at 09:00, with a preview of the next three runs',
    caption: 'Jobs re-apply sets and creators on any schedule, so new title cards and uploads arrive on their own.',
    doc: 'keeping-posters-up-to-date',
    edge: 'Weekly ▸ Mon 09:00 ▸ Next 3 runs shown',
  },
  {
    id: 'import',
    label: 'Manual Import',
    full: appliedFull,
    thumb: appliedThumb,
    alt: 'Manual Import with episode title cards already in the library marked Applied',
    caption: "Paste MediUX or ThePosterDB links. Art already in your library is marked, so you upload only what's new.",
    doc: 'supported-links',
    edge: 'Season 4 title cards ▸ Applied marked',
  },
  {
    id: 'reset',
    label: 'Reset Posters',
    full: resetFull,
    thumb: resetFull,
    alt: 'Reset Posters page listing applied art by title and source',
    caption: "Every poster you apply is logged with its source, and any title can go back to Plex's original art.",
    doc: 'how-matching-works',
    edge: '46 tracked ▸ 29 movies ▸ 12 shows',
  },
  {
    id: 'sign-in',
    label: 'Sign-in',
    full: settingsFull,
    thumb: settingsFull,
    alt: 'Settings page with the Plex account connected and libraries detected',
    caption: 'Sign in with Plex in your browser. Your server and libraries are found for you, with no tokens or config files.',
    doc: 'first-run',
    edge: 'Plex account ▸ Connected',
  },
]
