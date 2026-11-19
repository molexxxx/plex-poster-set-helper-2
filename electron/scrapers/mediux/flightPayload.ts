import { splitTrailingYear } from '../../services/titleParse'
import type { MediuxSet, Fallback } from './mediuxTypes'

/**
 * Cleans an RSC flight-payload script and parses it to JSON. Faithful port of
 * the Python parse_string_to_dict cleaning:
 * 1. remove all `\\\"` (3 backslashes + quote) sequences
 * 2. strip every remaining backslash
 * 3. replace `u0026` with `&`
 * 4. slice from first `{` to last `}` and JSON.parse
 *
 * @param scriptText - Raw text of one inline script tag.
 * @returns The parsed object, or null when nothing parses.
 */
function cleanAndParse(scriptText: string): unknown | null {
  const cleaned = scriptText
    .replace(/\\\\\\"/g, '')   // matches \ \ \ "
    .replace(/\\/g, '')        // strip remaining backslashes
    .replace(/u0026/g, '&')

  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Walks an arbitrary parsed object and collects every "set-like" node:
 * an object with a files[] array whose entries have id + fileType.
 *
 * @param root - Parsed RSC payload of unknown shape.
 * @returns The unique sets found, in discovery order.
 */
function collectSets(root: unknown): MediuxSet[] {
  const found: MediuxSet[] = []
  const seen = new Set<string | number>()

  const looksLikeSet = (o: Record<string, unknown>): boolean => {
    const files = o['files']
    return Array.isArray(files) && files.some(
      f => f && typeof f === 'object' && 'id' in f && 'fileType' in f,
    )
  }

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 10) return

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }

    const obj = node as Record<string, unknown>
    if (looksLikeSet(obj)) {
      const set = obj as unknown as MediuxSet
      if (!seen.has(set.id)) {
        seen.add(set.id)
        found.push(set)
      }
      // Don't descend into a set's own files
      return
    }

    for (const value of Object.values(obj)) walk(value, depth + 1)
  }

  walk(root, 0)
  return found
}

/**
 * Tells a real MediUX page from a block or challenge page: only MediUX's own
 * pages carry the Next.js flight payload. A real page without sets has none,
 * and a browser load would find none either.
 *
 * @param scriptTexts - Inline script contents from the page.
 * @returns True when any script pushes flight data.
 */
export function hasFlightData(scriptTexts: string[]): boolean
{
  return scriptTexts.some(s => s.includes('self.__next_f'))
}

/**
 * Parses every script's text and collects the sets across them.
 *
 * @param scriptTexts - Inline script contents from the page.
 * @returns Unique sets found across all matching scripts.
 */
export function setsFromScripts(scriptTexts: string[]): MediuxSet[] {
  const all: MediuxSet[] = []
  const seen = new Set<string | number>()

  for (const text of scriptTexts) {
    if (!text) continue
    // Must reference both files and set; skip the breadcrumb "Set Link\" script
    if (!text.includes('files') || !text.includes('set')) continue
    if (text.includes('Set Link\\')) continue

    const parsed = cleanAndParse(text)
    if (!parsed) continue

    for (const set of collectSets(parsed)) {
      if (!seen.has(set.id)) {
        seen.add(set.id)
        all.push(set)
      }
    }
  }

  return all
}

/**
 * Parses the page's og:title meta tag into a title/year fallback.
 *
 * @param html - Raw page HTML.
 * @returns Whatever title/year could be parsed.
 */
export function parseOgTitle(html: string): Fallback {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)
  if (!m?.[1]) return {}
  const raw = m[1].trim()
  return splitTrailingYear(raw) ?? { title: raw }
}
