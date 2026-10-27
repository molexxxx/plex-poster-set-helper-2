const PATHS = {
  prev: 'M15 5 8 12l7 7',
  next: 'M9 5l7 7-7 7',
  play: 'M8 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  enlarge: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  close: 'M6 6l12 12M18 6 6 18',
}

/** A 20px stroke icon for the round control buttons. */
export function Icon({ name }: { name: keyof typeof PATHS })
{
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={name === 'pause' ? 3 : 2.25} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  )
}
