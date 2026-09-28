import { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { ConfigService } from './services/config'
import { Logger } from './services/logger'
import { PlexService } from './services/plexService'
import { registerPlexHandlers } from './ipc/plexHandlers'
import { registerScrapeHandlers } from './ipc/scrapeHandlers'
import { registerBulkHandlers } from './ipc/bulkHandlers'
import { registerAuthHandlers } from './ipc/authHandlers'
import { registerAppHandlers } from './ipc/appHandlers'
import { registerLogHandlers } from './ipc/logHandlers'
import { registerSchedulerHandlers, wireSchedulerEvents } from './ipc/schedulerHandlers'
import { registerBrowserHandlers, wireBrowserEvents } from './ipc/browserHandlers'
import { registerLibraryHandlers } from './ipc/libraryHandlers'
import { SchedulerService } from './services/schedulerService'
import { PlaywrightService } from './services/playwrightService'

/**
 * Dev = running against the Vite dev server. Containers run an unpackaged
 * build but must load the built files, so PLEX_HELPER_PROD forces production.
 */
const isDev = !app.isPackaged && process.env.PLEX_HELPER_PROD !== '1'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let forceQuit = false
let trayAvailable = false

// Single-instance lock: a second launch (e.g. clicking the shortcut while
// minimised to tray) brings the existing window forward instead
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) showWindow()
  })
}

// Custom data dir (config, logs, browsers) for Docker volume mounts
if (process.env.PLEX_HELPER_CONFIG_DIR) {
  app.setPath('userData', process.env.PLEX_HELPER_CONFIG_DIR)
}

/** Append a line to boot.log (userData, else %TEMP%) for diagnosing silent Windows startups. */
function bootLog(message: string) {
  const line = `${new Date().toISOString()} ${message}\n`
  const targets = [
    path.join(app.getPath('userData'), 'boot.log'),
    path.join(os.tmpdir(), 'plex-poster-helper-boot.log'),
  ]
  for (const file of targets) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, line)
      return
    } catch { /* try next */ }
  }
}

function resolveIconsDir(): string {
  const candidates = [
    path.join(process.resourcesPath, 'icons'),
    path.join(__dirname, '../../resources/icons'),
    path.join(app.getAppPath(), '..', 'resources', 'icons'),
  ]
  for (const dir of candidates) {
    const tray = process.platform === 'win32'
      ? path.join(dir, 'tray.ico')
      : path.join(dir, 'tray-32.png')
    if (fs.existsSync(tray)) return dir
  }
  return candidates[0]
}

function resolveTrayIconPath(iconsDir: string): string {
  const primary = process.platform === 'win32'
    ? path.join(iconsDir, 'tray.ico')
    : path.join(iconsDir, 'tray-32.png')
  if (fs.existsSync(primary)) return primary
  const fallbacks = [
    path.join(iconsDir, 'tray-32.png'),
    path.join(iconsDir, 'app-256.png'),
    path.join(path.dirname(iconsDir), 'icon.ico'),
  ]
  return fallbacks.find(p => fs.existsSync(p)) ?? primary
}

function resolveAppIconPath(iconsDir: string): string {
  const p = path.join(iconsDir, 'app-256.png')
  return fs.existsSync(p) ? p : resolveTrayIconPath(iconsDir)
}

function resolveIndexHtml(): string {
  const candidates = [
    path.join(__dirname, '../../src/dist/index.html'),
    path.join(__dirname, '../src/dist/index.html'),
    path.join(app.getAppPath(), 'src/dist/index.html'),
  ]
  const found = candidates.find(p => fs.existsSync(p))
  if (!found) {
    bootLog(`index.html missing; tried: ${candidates.join(' | ')}`)
  }
  return found ?? candidates[0]
}

/** Creates the system tray icon with show/hide and quit actions. */
function setupTray(trayIconPath: string) {
  if (!fs.existsSync(trayIconPath)) {
    throw new Error(`Tray icon not found: ${trayIconPath}`)
  }
  tray = new Tray(trayIconPath)
  trayAvailable = true
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
  tray.on('double-click', () => showWindow())
}

/** Shows, focuses, and restores the main window. */
function showWindow() {
  if (!mainWindow) return
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
  if (mainWindow.isMinimized()) mainWindow.restore()
}

/** Toggles main-window visibility. */
function toggleWindow() {
  if (!mainWindow) return
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
  } else {
    showWindow()
  }
}

/**
 * Hides to tray and (optionally) shows a one-line notice. The notice is gated
 * by the `trayNotice` config flag so users can permanently silence it.
 */
function hideToTray(appIconPath: string) {
  if (!mainWindow) return
  mainWindow.hide()
  try {
    if (ConfigService.get().trayNotice !== false && Notification.isSupported()) {
      new Notification({
        title: 'Still running in the tray',
        body: 'Plex Poster Helper minimized to the system tray. Right-click the tray icon to quit.',
        icon: appIconPath,
        silent: true,
      }).show()
    }
  } catch { /* notifications best-effort */ }
}

/**
 * Creates the frameless main window and wires its load, close, and title-bar
 * IPC behaviour.
 *
 * @returns The created window.
 */
function createWindow(appIconPath: string) {
  const launchedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin
  const startHidden = launchedAtLogin && trayAvailable

  mainWindow = new BrowserWindow({
    width: 1620,
    height: 1080,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0d0f14',
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'hidden',
    icon: appIconPath,
  })

  const preloadPath = path.join(__dirname, 'preload.js')
  bootLog(`preload=${preloadPath} exists=${fs.existsSync(preloadPath)} packaged=${app.isPackaged}`)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const indexHtml = resolveIndexHtml()
    bootLog(`loadFile ${indexHtml}`)
    mainWindow.loadFile(indexHtml)
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    bootLog(`did-fail-load code=${code} desc=${desc} url=${url}`)
    showWindow()
    dialog.showErrorBox(
      'Plex Poster Helper failed to load',
      `${desc} (${code})\n\nSee boot.log in:\n${app.getPath('userData')}\nor %TEMP%\\plex-poster-helper-boot.log`,
    )
  })

  mainWindow.webContents.on('preload-error', (_e, p, err) => {
    bootLog(`preload-error path=${p} err=${err}`)
  })

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) showWindow()
  })

  // ready-to-show can fail to fire on some Windows/GPU setups - show once the page loads
  mainWindow.webContents.once('did-finish-load', () => {
    if (!startHidden && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      showWindow()
    }
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

  // Last resort: never leave the user with a headless process and no window
  setTimeout(() => {
    if (!startHidden && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      Logger.warn('App', 'Window still hidden after startup - forcing show')
      showWindow()
    }
  }, 5000)

  // Hide to tray instead of closing, unless forceQuit was set or the tray
  // couldn't be created
  mainWindow.on('close', e => {
    if (!forceQuit && trayAvailable) {
      e.preventDefault()
      hideToTray(appIconPath)
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
  // Title-bar close button behaves the same as clicking X
  ipcMain.on('window:close', () => {
    if (!forceQuit && trayAvailable) {
      hideToTray(appIconPath)
    } else {
      mainWindow?.close()
    }
  })

  return mainWindow
}

/** Initialises scheduler and the Playwright environment (call after createWindow + IPC). */
async function initServices() {
  PlaywrightService.setupEnv()
  if (mainWindow) {
    SchedulerService.init(mainWindow)
  }

  void PlaywrightService.bootstrap()
}

/** Wires electron-updater events to the renderer (packaged desktop builds only, never containers). */
function setupAutoUpdater() {
  if (!app.isPackaged) return

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

/** Registers all IPC handler groups. */
function registerIpcHandlers() {
  registerPlexHandlers(ipcMain)
  registerScrapeHandlers(ipcMain, mainWindow!)
  registerBulkHandlers(ipcMain)
  registerAuthHandlers(ipcMain, mainWindow!)
  registerAppHandlers(ipcMain)
  registerLogHandlers(ipcMain)
  registerSchedulerHandlers(ipcMain)
  registerBrowserHandlers(ipcMain)
  registerLibraryHandlers(ipcMain, mainWindow!)
}

app.whenReady().then(async () => {
  try {
    bootLog(`startup userData=${app.getPath('userData')} resources=${process.resourcesPath}`)
    await ConfigService.init()
    bootLog('config initialized')

    const iconsDir = resolveIconsDir()
    const trayIcon = resolveTrayIconPath(iconsDir)
    const appIcon = resolveAppIconPath(iconsDir)
    bootLog(`icons dir=${iconsDir} tray=${trayIcon} app=${appIcon}`)

    try {
      setupTray(trayIcon)
      bootLog('tray created')
    } catch (err) {
      bootLog(`tray failed: ${err instanceof Error ? err.message : err}`)
      trayAvailable = false
    }

    createWindow(appIcon)
    bootLog('window created')
    Logger.init(mainWindow)
    registerIpcHandlers()
    if (mainWindow) {
      wireSchedulerEvents(mainWindow)
      wireBrowserEvents(mainWindow)
    }
    await initServices()
    setupAutoUpdater()
    bootLog('startup complete')
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err)
    bootLog(`startup fatal: ${msg}`)
    dialog.showErrorBox(
      'Plex Poster Helper failed to start',
      `${msg}\n\nLogs: ${app.getPath('userData')}\\boot.log\nor %TEMP%\\plex-poster-helper-boot.log`,
    )
    app.exit(1)
  }

  // macOS: re-show when clicking the dock icon
  app.on('activate', () => {
    if (mainWindow) {
      showWindow()
    } else {
      createWindow(resolveAppIconPath(resolveIconsDir()))
    }
  })
}).catch(err => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err)
  try { bootLog(`whenReady rejected: ${msg}`) } catch { /* */ }
  dialog.showErrorBox('Plex Poster Helper failed to start', msg)
  app.exit(1)
})

process.on('uncaughtException', err => {
  bootLog(`uncaughtException: ${err.stack ?? err.message}`)
})
process.on('unhandledRejection', reason => {
  bootLog(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
})

// The tray keeps the app alive when all windows close. If the tray couldn't be
// created there's nothing to restore from, so quit instead of orphaning.
app.on('window-all-closed', () => {
  if (!trayAvailable) app.quit()
})

// Ensure forceQuit is set before close handlers fire (e.g. from app.quit() calls)
app.on('before-quit', () => {
  forceQuit = true
  PlaywrightService.shutdown()
})

app.on('open-url', (_event, url) => {
  shell.openExternal(url)
})

export { mainWindow }
