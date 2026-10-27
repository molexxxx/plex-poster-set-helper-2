const base = import.meta.env.BASE_URL

export type Page = 'overview' | 'docs' | 'changelog'

/** Site-relative links that respect the GitHub Pages base path. */
export const links = {
  overview: base,
  docs: `${base}docs/`,
  changelog: `${base}changelog/`,
  doc: (anchor: string) => `${base}docs/#${anchor}`,
}
