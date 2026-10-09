/**
 * Extracts a user-facing message from an error thrown across IPC or the web API.
 *
 * Electron wraps errors from the main process as "Error invoking remote method
 * 'channel': ErrorName: message"; only the message is meant for the user.
 *
 * @param err - The caught value.
 * @returns The bare message.
 */
export function errorMessage(err: unknown): string
{
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  const message = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^[A-Za-z]*Error:\s*/, '')
    .trim()
  return message || 'Something went wrong'
}
