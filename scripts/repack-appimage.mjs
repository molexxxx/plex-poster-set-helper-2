#!/usr/bin/env node
/**
 * Repacks the electron-builder AppImage with appimagetool so the published
 * file ships the static AppImage runtime (no libfuse2 dependency), embeds
 * AppImageUpdate update information with a companion .zsync file, and carries
 * AppStream metainfo. latest-linux.yml is rewritten with the new checksum and
 * size so electron-updater keeps verifying the replaced file.
 *
 * Usage: node scripts/repack-appimage.mjs [dist-dir]
 *
 * Environment:
 *   APPIMAGE_UPDATE_INFO  update information to embed (defaults to the
 *                         gh-releases-zsync spec for this repository)
 *   APPIMAGETOOL_URL      alternative download URL for appimagetool
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const METAINFO_ID = 'com.molexxxx.plex-poster-set-helper-2'
const DEFAULT_UPDATE_INFO =
  'gh-releases-zsync|molexxxx|plex-poster-set-helper-2|latest|Plex-Poster-Set-Helper-2-*-x64.AppImage.zsync'
const DEFAULT_TOOL_URL =
  'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage'

function log(message)
{
  process.stdout.write(`[repack] ${message}\n`)
}

function run(command, args, options = {})
{
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0)
  {
    const tail = `${String(result.stderr)}\n${String(result.stdout)}`.trim().slice(-4000)
    throw new Error(`${path.basename(command)} ${args.join(' ')} exited with ${result.status}\n${tail}`)
  }
  return String(result.stdout)
}

async function download(url, destination)
{
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) ${url}`)
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination))
}

async function sha512Base64(file)
{
  const hash = createHash('sha512')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

/**
 * Rewrites the AppImage entry of latest-linux.yml with the repacked file's
 * checksum and size. The embedded block map is gone after the repack, so its
 * size field is dropped and electron-updater falls back to a full download.
 */
function patchManifest(manifestPath, name, sha512, size)
{
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(eol)
  let inEntry = false
  let touched = 0
  for (let i = 0; i < lines.length; i++)
  {
    const line = lines[i]
    if (/^\s+- url: /.test(line)) inEntry = line.trim() === `- url: ${name}`
    else if (/^\S/.test(line)) inEntry = false
    if (!inEntry) continue
    if (/^\s+sha512: /.test(line))
    {
      lines[i] = line.replace(/sha512: .*/, `sha512: ${sha512}`)
      touched++
    }
    else if (/^\s+size: /.test(line))
    {
      lines[i] = line.replace(/size: .*/, `size: ${size}`)
      touched++
    }
    else if (/^\s+blockMapSize: /.test(line))
    {
      lines.splice(i, 1)
      i--
    }
  }
  if (touched < 2) throw new Error(`latest-linux.yml has no files entry for ${name}`)

  const pathIndex = lines.findIndex(line => line.startsWith('path: '))
  if (pathIndex !== -1 && lines[pathIndex].slice('path: '.length).trim() === name)
  {
    const shaIndex = lines.findIndex(line => line.startsWith('sha512: '))
    if (shaIndex === -1) throw new Error('latest-linux.yml has no top-level sha512')
    lines[shaIndex] = `sha512: ${sha512}`
  }
  fs.writeFileSync(manifestPath, lines.join(eol))
}

async function main()
{
  if (process.platform !== 'linux') throw new Error('AppImage repacking only runs on Linux')

  const distDir = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist-electron'))
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const candidates = fs.readdirSync(distDir).filter(file => file.endsWith('.AppImage'))
  if (candidates.length !== 1)
  {
    throw new Error(`Expected exactly one .AppImage in ${distDir}, found ${candidates.length}`)
  }
  const name = candidates[0]
  const original = path.join(distDir, name)
  const manifest = path.join(distDir, 'latest-linux.yml')
  if (!fs.existsSync(manifest)) throw new Error(`Missing ${manifest}`)
  const updateInfo = process.env.APPIMAGE_UPDATE_INFO || DEFAULT_UPDATE_INFO
  const toolUrl = process.env.APPIMAGETOOL_URL || DEFAULT_TOOL_URL

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-repack-'))
  try
  {
    const tool = path.join(work, 'appimagetool')
    log(`downloading appimagetool from ${toolUrl}`)
    await download(toolUrl, tool)
    fs.chmodSync(tool, 0o755)

    log(`extracting ${name}`)
    fs.chmodSync(original, 0o755)
    run(original, ['--appimage-extract'], { cwd: work })
    const appDir = path.join(work, 'squashfs-root')
    if (!fs.existsSync(path.join(appDir, 'AppRun'))) throw new Error('extracted AppDir has no AppRun')

    const metaDir = path.join(appDir, 'usr', 'share', 'metainfo')
    fs.mkdirSync(metaDir, { recursive: true })
    const template = fs.readFileSync(path.join(ROOT, 'resources', 'linux', `${METAINFO_ID}.metainfo.xml`), 'utf8')
    const today = new Date().toISOString().slice(0, 10)
    fs.writeFileSync(
      path.join(metaDir, `${METAINFO_ID}.metainfo.xml`),
      template.replaceAll('@VERSION@', pkg.version).replaceAll('@DATE@', today),
    )

    const output = path.join(work, name)
    log('building the AppImage with the static runtime')
    run(tool, ['--appimage-extract-and-run', '--no-appstream', '--comp', 'zstd', '-u', updateInfo, appDir, output], {
      cwd: work,
      env: { ...process.env, ARCH: 'x86_64' },
    })
    const zsync = `${output}.zsync`
    if (!fs.existsSync(zsync)) throw new Error('appimagetool did not produce a .zsync file')

    fs.chmodSync(output, 0o755)
    const embedded = run(output, ['--appimage-updateinformation']).trim()
    if (embedded !== updateInfo) throw new Error(`embedded update information mismatch: "${embedded}"`)

    fs.copyFileSync(output, original)
    fs.copyFileSync(zsync, `${original}.zsync`)
    const sha512 = await sha512Base64(original)
    const size = fs.statSync(original).size
    patchManifest(manifest, name, sha512, size)
    log(`replaced ${name} (${size} bytes) and wrote ${name}.zsync`)
  }
  finally
  {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

main().catch(error =>
{
  console.error(`[repack] ${error.message}`)
  process.exit(1)
})
