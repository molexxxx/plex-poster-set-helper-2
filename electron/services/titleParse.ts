/**
 * Linear-time helpers for trimming suffixes and years off titles.
 *
 * Patterns that open with `\s*`, `\s+`, or `^(.*?)\s*` let the regex engine
 * retry from every position inside a whitespace run, which is quadratic in the
 * run's length. Titles arrive from Plex, the poster sites, and the web API, so
 * every pattern here starts on a non-whitespace token and the whitespace before
 * the match is trimmed separately.
 */

/**
 * Removes a suffix and the whitespace before it.
 *
 * @param text - Text to strip.
 * @param tail - End-anchored pattern for the suffix whose first token is not
 *   whitespace, e.g. `/-\s*Backdrop\s*$/i`.
 * @param spaced - Strip only when whitespace separates the suffix from the
 *   text before it.
 * @returns The text before the suffix with trailing whitespace removed, or the
 *   input unchanged when it has no such suffix.
 */
export function stripSuffix(text: string, tail: RegExp, spaced = false): string
{
  const match = tail.exec(text)
  if (!match) return text
  const head = text.slice(0, match.index)
  const trimmed = head.trimEnd()
  return spaced && trimmed.length === head.length ? text : trimmed
}

/**
 * Splits a title that ends in "(YYYY)" into the name and the year.
 *
 * @param text - Title such as "Toy Story 2 (1999)".
 * @returns The trimmed name and the year, or null when the title does not end
 *   in a year.
 */
export function splitTrailingYear(text: string): { title: string; year: number } | null
{
  const match = /\((\d{4})\)\s*$/.exec(text)
  return match ? { title: text.slice(0, match.index).trim(), year: Number(match[1]) } : null
}
