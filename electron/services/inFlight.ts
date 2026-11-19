/**
 * Creates a gate that shares one run of a task among every caller asking for
 * the same key while it is running. Once the run settles, the next call for
 * the key starts a new one, so a failure is never handed to a later caller.
 *
 * @returns A function taking the key and the task, resolving to the task's result.
 */
export function createInFlight<T>(): (key: string, run: () => Promise<T>) => Promise<T>
{
  const running = new Map<string, Promise<T>>()
  return (key, run) =>
  {
    const existing = running.get(key)
    if (existing) return existing
    const started = (async () => run())().finally(() => running.delete(key))
    running.set(key, started)
    return started
  }
}
