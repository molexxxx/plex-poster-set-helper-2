#!/usr/bin/env node
/**
 * Downloads the Chromium headless shell into resources/browsers so installers
 * and the Docker image ship it and first run needs no download. Retries the
 * Playwright installer to ride out transient network failures.
 *
 * Usage: node scripts/fetch-browser.mjs [target-dir]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = 'INSTALLATION_COMPLETE'
const ATTEMPTS = 3

const target = path.resolve(process.argv[2] ?? path.join(ROOT, 'resources', 'browsers'))
const cli = path.join(ROOT, 'node_modules', 'playwright', 'cli.js')

function shellReady(dir)
{
  let entries
  try
  {
    entries = fs.readdirSync(dir)
  }
  catch
  {
    return false
  }
  return entries
    .filter(name => name.startsWith('chromium_headless_shell-') || name.startsWith('chromium-headless-shell-'))
    .some(name => fs.existsSync(path.join(dir, name, MARKER)))
}

if (!fs.existsSync(cli))
{
  console.error(`[browser] Playwright CLI not found at ${cli}; run npm install first`)
  process.exit(1)
}
fs.mkdirSync(target, { recursive: true })

for (let attempt = 1; attempt <= ATTEMPTS; attempt++)
{
  console.log(`[browser] installing the Chromium headless shell into ${target} (attempt ${attempt}/${ATTEMPTS})`)
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium', '--only-shell'], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: target, PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '60000' },
  })
  if (result.status === 0 && shellReady(target))
  {
    console.log('[browser] headless shell ready')
    process.exit(0)
  }
  console.error(`[browser] attempt ${attempt} failed (exit code ${result.status ?? 'none'})`)
  if (attempt < ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 10_000 * attempt))
}
process.exit(1)
