import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findPermissionProblems, normalizedMode, normalizeTree, parseListing } from './appimage-permissions.mjs'

const SOUND_LISTING = [
  'Parallel unsquashfs: Using 8 processors',
  '1234 inodes (5678 blocks) to write',
  '',
  'drwxr-xr-x root/root               321 2026-09-28 12:22 R',
  'lrwxrwxrwx root/root                65 2026-09-28 12:22 R/.DirIcon -> usr/share/icons/hicolor/512x512/apps/app.png',
  '-rwxr-xr-x root/root              3499 2026-09-28 12:22 R/AppRun',
  'drwxr-xr-x root/root               123 2026-09-28 12:22 R/resources',
  '-rw-r--r-- root/root          12345678 2026-09-28 12:22 R/resources/app.asar',
  'drwxr-xr-x root/root                40 2026-09-28 12:22 R/usr/share/metainfo',
  '-rw-r--r-- root/root              1500 2026-09-28 12:22 R/usr/share/metainfo/app.appdata.xml',
].join('\n')

describe('normalizedMode', () =>
{
  it('makes directories 0755 whatever they were', () =>
  {
    expect(normalizedMode(0o700, true)).toBe(0o755)
    expect(normalizedMode(0o777, true)).toBe(0o755)
  })

  it('makes files readable by all and executable by all when the owner can execute', () =>
  {
    expect(normalizedMode(0o600, false)).toBe(0o644)
    expect(normalizedMode(0o700, false)).toBe(0o755)
    expect(normalizedMode(0o744, false)).toBe(0o755)
  })

  it('removes group and world write', () =>
  {
    expect(normalizedMode(0o666, false)).toBe(0o644)
    expect(normalizedMode(0o777, false)).toBe(0o755)
  })
})

describe('normalizeTree', () =>
{
  let root

  beforeEach(() =>
  {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'appdir-'))
  })

  afterEach(() =>
  {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('opens up 0700 directories and 0600 files', () =>
  {
    const nested = path.join(root, 'resources', 'browsers')
    fs.mkdirSync(nested, { recursive: true, mode: 0o700 })
    fs.chmodSync(path.join(root, 'resources'), 0o700)
    fs.chmodSync(root, 0o700)
    const file = path.join(nested, 'chrome-headless-shell')
    fs.writeFileSync(file, '', { mode: 0o700 })
    const data = path.join(nested, 'data.pak')
    fs.writeFileSync(data, '', { mode: 0o600 })

    expect(normalizeTree(root)).toBeGreaterThan(0)
    expect(fs.statSync(root).mode & 0o777).toBe(0o755)
    expect(fs.statSync(nested).mode & 0o777).toBe(0o755)
    expect(fs.statSync(file).mode & 0o777).toBe(0o755)
    expect(fs.statSync(data).mode & 0o777).toBe(0o644)
    expect(normalizeTree(root)).toBe(0)
  })
})

describe('parseListing', () =>
{
  it('keeps entries under the listing root and strips link targets', () =>
  {
    const entries = parseListing(SOUND_LISTING)
    expect(entries.map(entry => entry.path)).toEqual([
      '', '.DirIcon', 'AppRun', 'resources', 'resources/app.asar', 'usr/share/metainfo', 'usr/share/metainfo/app.appdata.xml',
    ])
    expect(entries[0]).toEqual({ type: 'd', perms: 'rwxr-xr-x', owner: 'root/root', path: '' })
  })
})

describe('findPermissionProblems', () =>
{
  it('accepts a sound image with the required files', () =>
  {
    const problems = findPermissionProblems(parseListing(SOUND_LISTING), {
      required: ['usr/share/metainfo/app.appdata.xml', /^resources\/app\.asar$/],
    })
    expect(problems).toEqual([])
  })

  it('reports the 0700 directories that broke v2.4.0 under firejail', () =>
  {
    const listing = SOUND_LISTING
      .replace('drwxr-xr-x root/root               321', 'drwx------ root/root               321')
      .replace('drwxr-xr-x root/root               123', 'drwx------ root/root               123')
    const problems = findPermissionProblems(parseListing(listing))
    expect(problems).toContain('directory / is drwx------, not traversable by all users')
    expect(problems).toContain('directory resources is drwx------, not traversable by all users')
  })

  it('reports unreadable files, writable files, foreign owners, and a non-executable AppRun', () =>
  {
    const listing = SOUND_LISTING
      .replace('-rw-r--r-- root/root          12345678', '-rw------- root/root          12345678')
      .replace('-rw-r--r-- root/root              1500', '-rw-rw-rw- runner/runner       1500')
      .replace('-rwxr-xr-x root/root              3499', '-rwxr--r-- root/root              3499')
    const problems = findPermissionProblems(parseListing(listing))
    expect(problems).toContain('file resources/app.asar is -rw-------, not readable by all users')
    expect(problems).toContain('file usr/share/metainfo/app.appdata.xml is writable by group or others')
    expect(problems).toContain('usr/share/metainfo/app.appdata.xml is owned by runner/runner, not root')
    expect(problems).toContain('AppRun is -rwxr--r--, not executable by all users')
  })

  it('reports missing required entries and an empty listing', () =>
  {
    expect(findPermissionProblems(parseListing(SOUND_LISTING), { required: ['usr/share/metainfo/other.appdata.xml'] }))
      .toEqual(['usr/share/metainfo/other.appdata.xml is missing from the image'])
    expect(findPermissionProblems([])).toEqual(['the image listing is empty'])
  })
})
