/**
 * Permission handling for the AppImage repack. An AppImage is usually mounted
 * through FUSE, which does not enforce permissions, but sandboxes such as
 * firejail and any kernel loop mount do. Every directory must therefore be
 * traversable and every file readable by all users, with root ownership.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Mode an AppDir entry should carry: directories 0755, files readable by all,
 * executable by all when the owner can execute, and never group or world
 * writable.
 *
 * @param {number} mode - Current permission bits.
 * @param {boolean} isDirectory - Whether the entry is a directory.
 * @returns {number} Normalized permission bits.
 */
export function normalizedMode(mode, isDirectory)
{
  if (isDirectory) return 0o755
  let next = (mode | 0o444) & ~0o022 & 0o777
  if (mode & 0o100) next |= 0o111
  return next
}

/**
 * Applies normalizedMode to every directory and regular file under a root,
 * leaving symbolic links untouched.
 *
 * @param {string} root - AppDir to normalize.
 * @returns {number} Count of entries whose mode changed.
 */
export function normalizeTree(root)
{
  let changed = 0
  const stack = [root]
  while (stack.length)
  {
    const current = stack.pop()
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) continue
    const isDirectory = stat.isDirectory()
    const mode = stat.mode & 0o777
    const target = normalizedMode(mode, isDirectory)
    if (target !== mode)
    {
      fs.chmodSync(current, target)
      changed++
    }
    if (isDirectory)
    {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry))
    }
  }
  return changed
}

const LISTING_LINE = /^([dlcbps-])([rwxsStT-]{9})\s+(\S+)\s+\S+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/

/**
 * Parses `unsquashfs -lls -d R` output into entries relative to the image root.
 *
 * @param {string} listing - Raw listing text.
 * @returns {{ type: string, perms: string, owner: string, path: string }[]} Entries; the root is ''.
 */
export function parseListing(listing)
{
  const entries = []
  for (const line of listing.split(/\r?\n/))
  {
    const match = LISTING_LINE.exec(line.trim())
    if (!match) continue
    const [, type, perms, owner, rawName] = match
    const name = type === 'l' ? rawName.replace(/ -> .*$/, '') : rawName
    if (name !== 'R' && !name.startsWith('R/')) continue
    entries.push({ type, perms, owner, path: name === 'R' ? '' : name.slice(2) })
  }
  return entries
}

/**
 * Problems that would stop an unprivileged user, or a sandbox that enforces
 * permissions, from running the image.
 *
 * @param {{ type: string, perms: string, owner: string, path: string }[]} entries - Parsed listing.
 * @param {{ required?: (string | RegExp)[] }} [options] - Paths that must be present.
 * @returns {string[]} One message per problem; empty when the image is sound.
 */
export function findPermissionProblems(entries, options = {})
{
  const problems = []
  if (!entries.length) return ['the image listing is empty']
  for (const entry of entries)
  {
    const label = entry.path || '/'
    const other = entry.perms.slice(6)
    if (entry.owner !== 'root/root' && entry.owner !== '0/0') problems.push(`${label} is owned by ${entry.owner}, not root`)
    if (entry.type === 'd' && (other[0] !== 'r' || !/[xt]/.test(other[2]))) problems.push(`directory ${label} is ${entry.type}${entry.perms}, not traversable by all users`)
    if (entry.type === '-' && other[0] !== 'r') problems.push(`file ${label} is ${entry.type}${entry.perms}, not readable by all users`)
    if (entry.type === '-' && /[wW]/.test(entry.perms[4] + entry.perms[7])) problems.push(`file ${label} is writable by group or others`)
  }
  const appRun = entries.find(entry => entry.path === 'AppRun')
  if (!appRun) problems.push('AppRun is missing')
  else if (appRun.type === '-' && !/[xt]/.test(appRun.perms[8])) problems.push(`AppRun is -${appRun.perms}, not executable by all users`)
  for (const required of options.required ?? [])
  {
    const present = entries.some(entry => (typeof required === 'string' ? entry.path === required : required.test(entry.path)))
    if (!present) problems.push(`${required} is missing from the image`)
  }
  return problems
}
