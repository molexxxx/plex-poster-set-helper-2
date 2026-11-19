import type { RunResult } from './hooks/useBulkFiles'

/**
 * Strips the .txt extension for display.
 *
 * @param filename - Stored bulk filename.
 * @returns The name without its extension.
 */
export function displayName(filename: string)
{
  return filename.replace(/\.txt$/, '')
}

/**
 * Reads the URLs in a bulk file's text.
 *
 * @param content - The editor's text.
 * @returns One URL per non-blank line, trimmed.
 */
export function urlLines(content: string): string[]
{
  return content.split('\n').map(l => l.trim()).filter(Boolean)
}

/**
 * Adds the .txt extension to a file name typed without it.
 *
 * @param name - The name as typed.
 * @returns The stored filename.
 */
export function withTxt(name: string): string
{
  return name.endsWith('.txt') ? name : `${name}.txt`
}

/**
 * The note beside one URL's run result.
 *
 * @param r - What the URL's run did.
 * @returns The error (cut to 50 characters), "no posters found", or how many posters were uploaded.
 */
export function resultNote(r: RunResult): string | undefined
{
  return r.status === 'error'
    ? r.error?.slice(0, 50)
    : r.status === 'no_match'
    ? 'no posters found'
    : `${r.uploadedCount}/${r.posterCount} uploaded`
}
