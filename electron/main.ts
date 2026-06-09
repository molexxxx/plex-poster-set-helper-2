import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import { ConfigService } from './services/config'
import { Logger } from './services/logger'
import { PlexService } from './services/plexService'
import { registerPlexHandlers } from './ipc/plexHandlers'
import { registerScrapeHandlers } from './ipc/scrapeHandlers'
import { registerBulkHandlers } from './ipc/bulkHandlers'
import { registerAuthHandlers } from './ipc/authHandlers'
import { registerAppHandlers } from './ipc/appHandlers'
import { registerLogHandlers } from './ipc/logHandlers'
import { registerSchedulerHandlers } from './ipc/schedulerHandlers'
import { registerBrowserHandlers } from './ipc/browserHandlers'
import { registerLibraryHandlers } from './ipc/libraryHandlers'
import { SchedulerService } from './services/schedulerService'
import { PlaywrightService } from './services/playwrightService'

// Dev = running against the Vite dev server. In containers we run an unpackaged
// build but must load the built files, so PLEX_HELPER_PROD forces production.
const isDev = !app.isPackaged && process.env.PLEX_HELPER_PROD !== '1'

// Headless mode - for Docker / unraid: run the scheduler with no GUI or tray.
const HEADLESS = process.env.PLEX_HELPER_HEADLESS === '1' || process.argv.includes('--headless')

// No-tray mode - for the container GUI (KasmVNC), where there's no usable system
// tray to restore from, so closing should quit (the desktop autostart relaunches).
const NO_TRAY = process.env.PLEX_HELPER_NO_TRAY === '1'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let forceQuit = false

// Single-instance lock: if a second instance tries to launch while the app is
// running (e.g. the user clicks the shortcut while it's minimised to tray),
// bring the existing window to the foreground instead of opening a new one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) showWindow()
  })
}

// Containers have no GPU/display and run as root - relax accordingly.
if (HEADLESS) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('no-sandbox')
}

// Allow a custom data dir (config, logs, browsers) for Docker volume mounts.
if (process.env.PLEX_HELPER_CONFIG_DIR) {
  app.setPath('userData', process.env.PLEX_HELPER_CONFIG_DIR)
}

// --- Tray icon (orange play triangle, generated - no asset file required) -----
// Matches the title-bar mark. NOTE: createFromBuffer expects BGRA byte order on
// Windows, so channels are written B, G, R, A (writing RGBA renders blue).

function createTrayIcon(): Electron.NativeImage {
  const size = 16
  const ss = 3                       // 3×3 supersampling for smooth edges
  const buf = Buffer.alloc(size * size * 4)

  // Right-pointing play triangle in 16px space
  const ax = 4.8, ay = 3.2          // top-left
  const bx = 4.8, by = 12.8         // bottom-left
  const cx = 12.6, cy = 8.0         // tip

  const sign = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) =>
    (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)

  const inside = (px: number, py: number) => {
    const d1 = sign(px, py, ax, ay, bx, by)
    const d2 = sign(px, py, bx, by, cx, cy)
    const d3 = sign(px, py, cx, cy, ax, ay)
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    return !(hasNeg && hasPos)
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss
          const py = y + (sy + 0.5) / ss
          if (inside(px, py)) hits++
        }
      }
      if (hits === 0) continue
      const i = (y * size + x) * 4
      buf[i]     = 0x0d   // B
      buf[i + 1] = 0xa0   // G
      buf[i + 2] = 0xe5   // R
      buf[i + 3] = Math.round((hits / (ss * ss)) * 255)
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

// --- Tray setup ---------------------------------------------------------------

function setupTray() {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('Plex Poster Helper')

  function buildMenu() {
    const visible = mainWindow?.isVisible() ?? false
    return Menu.buildFromTemplate([
      {
        label: 'Plex Poster Helper',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: visible ? 'Hide' : 'Show',
        click: () => toggleWindow(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          forceQuit = true
          app.quit()
        },
      },
    ])
  }

  tray.on('click', () => toggleWindow())
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildMenu())
  })

  // Keep context menu fresh when rebuilt
  tray.on('double-click', () => showWindow())
}

function showWindow() {
  if (!mainWindow) return
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  if (mainWindow.isMinimized()) mainWindow.restore()
}

function toggleWindow() {
  if (!mainWindow) return
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
  } else {
    showWindow()
  }
}

// Hide to tray and (optionally) show a one-line notice. The notice is gated by
// the `trayNotice` config flag so users can permanently silence it.
function hideToTray() {
  if (!mainWindow) return
  mainWindow.hide()
  try {
    if (ConfigService.get().trayNotice !== false && Notification.isSupported()) {
      new Notification({
        title: 'Still running in the tray',
        body: 'Plex Poster Helper minimized to the system tray. Right-click the tray icon to quit.',
        icon: createTrayIcon(),
        silent: true,
      }).show()
    }
  } catch { /* notifications best-effort */ }
}

// --- Window -------------------------------------------------------------------

function createWindow() {
  const launchedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin

  mainWindow = new BrowserWindow({
    width: 1620,
    height: 1080,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0d0f14',
    // Start hidden if launched at login so it silently goes to tray
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../../resources/icon.png'),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // __dirname is electron/dist. The built renderer is at src/dist. Handle both
    // the packaged layout and the raw (container) layout.
    const candidates = [
      path.join(__dirname, '../../src/dist/index.html'), // raw build: app/electron/dist → app/src/dist
      path.join(__dirname, '../src/dist/index.html'),    // packaged layout
    ]
    const indexHtml = candidates.find(p => fs.existsSync(p)) ?? candidates[0]
    mainWindow.loadFile(indexHtml)
  }

  mainWindow.once('ready-to-show', () => {
    // Don't pop the window if the user launched us via login items
    if (!launchedAtLogin) mainWindow?.show()
  })

  // Auto-reconnect from saved credentials once the renderer is interactive
  mainWindow.webContents.once('did-finish-load', () => {
    PlexService.tryRestoreFromConfig().then(result => {
      if (result.success) {
        mainWindow?.webContents.send('auth:statusChange', {
          status: 'authorized',
          serverName: result.serverName,
        })
        Logger.info('App', 'Auto-reconnected to Plex from saved config')
      } else if (result.tokenInvalid) {
        // Token was revoked - reset renderer auth state so user sees the sign-in prompt
        mainWindow?.webContents.send('auth:statusChange', { status: 'idle' })
      }
    }).catch(() => {})
  })

  // Hide to tray instead of closing - unless forceQuit was set, or there's no
  // usable tray (container GUI), in which case a real close is allowed.
  mainWindow.on('close', e => {
    if (!forceQuit && !NO_TRAY) {
      e.preventDefault()
      hideToTray()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  // Title-bar close button → hide to tray (same as clicking X)
  ipcMain.on('window:close', () => {
    if (!forceQuit && !NO_TRAY) {
      hideToTray()
    } else {
      mainWindow?.close()
    }
  })

  return mainWindow
}

// --- Services -----------------------------------------------------------------

async function initServices() {
  await ConfigService.init()
  Logger.init(mainWindow)
  // Set PLAYWRIGHT_BROWSERS_PATH after Logger is ready
  PlaywrightService.setupEnv()
  if (mainWindow) {
    SchedulerService.init(mainWindow)
    PlaywrightService.init(mainWindow)
  }

  // Bootstrap Chromium if missing - same first-run QOL as the desktop app, but
  // driven from the main process so it's reliable in containers too (the
  // SetupScreen still shows progress; the install is idempotent).
  void bootstrapBrowser()
}

async function bootstrapBrowser() {
  try {
    const status = await PlaywrightService.getStatus()
    if (status.installed) return
    Logger.info('App', 'Chromium not found - installing (first run)…')
    await PlaywrightService.install()
    PlaywrightService.setupEnv()
    Logger.success('App', 'Chromium ready')
  } catch (err) {
    Logger.error('App', `Chromium bootstrap failed: ${err instanceof Error ? err.message : err}`)
  }
}

// --- Auto-updater -------------------------------------------------------------

function setupAutoUpdater() {
  if (!app.isPackaged) return   // only for packaged desktop builds, never in containers

  autoUpdater.autoDownload = false
  autoUpdater.checkForUpdatesAndNotify()

  autoUpdater.on('update-available', info => {
    mainWindow?.webContents.send('app:updateAvailable', info)
  })

  autoUpdater.on('download-progress', progress => {
    mainWindow?.webContents.send('app:downloadProgress', progress)
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('app:updateReady')
  })
}

// --- IPC ----------------------------------------------------------------------

function registerIpcHandlers() {
  registerPlexHandlers(ipcMain)
  registerScrapeHandlers(ipcMain, mainWindow!)
  registerBulkHandlers(ipcMain)
  registerAuthHandlers(ipcMain, mainWindow!)
  registerAppHandlers(ipcMain)
  registerLogHandlers(ipcMain)
  registerSchedulerHandlers(ipcMain)
  registerBrowserHandlers(ipcMain)
  registerLibraryHandlers(ipcMain)
}

// --- Headless boot (Docker / unraid) -------------------------------------------
// Runs config + scheduler with no window. Plex creds come from PLEX_BASEURL /
// PLEX_TOKEN env vars (safeStorage is unavailable in containers).

async function runHeadless() {
  await ConfigService.init()
  Logger.init(null)
  PlaywrightService.setupEnv()

  // Auto-install Chromium on first run (no GUI setup screen in headless)
  const browser = await PlaywrightService.getStatus()
  if (!browser.installed) {
    Logger.info('Headless', 'Installing Chromium (first run)…')
    try {
      await PlaywrightService.install()
      PlaywrightService.setupEnv()
      Logger.success('Headless', 'Chromium installed')
    } catch (err) {
      Logger.error('Headless', `Chromium install failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Env vars override stored config (useful for first-run or debugging).
  // If env vars are absent, credentials come from the shared config volume.
  const envBase  = process.env.PLEX_BASEURL?.trim()
  const envToken = process.env.PLEX_TOKEN?.trim()
  if (envBase && envToken) {
    ConfigService.set({ baseUrl: envBase, token: envToken })
    Logger.info('Headless', 'Using Plex credentials from environment variables (PLEX_BASEURL / PLEX_TOKEN)')
  }

  const cfg = ConfigService.get()
  const baseUrl = envBase || cfg.baseUrl
  const token   = envToken || cfg.token

  if (baseUrl && token) {
    const res = await PlexService.connect({ baseUrl, token })
    if (res.success) Logger.success('Headless', `Connected to Plex "${res.serverName}"`)
    else Logger.error('Headless', `Plex connection failed: ${res.error}`)
  } else {
    Logger.warn('Headless', 'No Plex credentials found in config or environment variables. ' +
      'Either mount a config volume with existing credentials, or set PLEX_BASEURL and PLEX_TOKEN.')
  }

  SchedulerService.init(null)
  const jobs = ConfigService.get().scheduledJobs ?? []
  Logger.success('Headless', `Scheduler running - ${jobs.filter(j => j.enabled).length}/${jobs.length} job(s) active. Press Ctrl+C to stop.`)
}

// --- Boot ---------------------------------------------------------------------

app.whenReady().then(async () => {
  if (HEADLESS) {
    await runHeadless().catch(err => {
      console.error('Headless boot failed:', err)
      app.exit(1)
    })
    return
  }

  createWindow()
  if (!NO_TRAY) setupTray()
  // Register IPC first so the renderer never gets "no handler" errors
  registerIpcHandlers()
  await initServices().catch(err => console.error('initServices failed:', err))
  setupAutoUpdater()

  app.on('activate', () => {
    // macOS: re-show when clicking dock icon
    if (mainWindow) {
      showWindow()
    } else {
      createWindow()
    }
  })
})

// Prevent default quit-on-all-closed - tray keeps the app alive.
// In no-tray container GUI mode, quit so the desktop autostart relaunches cleanly.
app.on('window-all-closed', () => {
  if (NO_TRAY) app.quit()
})

// Ensure forceQuit is set before-quit fires (e.g. from app.quit() calls)
app.on('before-quit', () => {
  forceQuit = true
})

app.on('open-url', (_event, url) => {
  shell.openExternal(url)
})

export { mainWindow }
