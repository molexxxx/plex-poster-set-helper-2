import winston from 'winston'
import path from 'path'
import fs from 'fs'
import { app, BrowserWindow } from 'electron'
import type { LogEntry } from '../ipc/types'

const CUSTOM_LEVELS = {
  levels: { error: 0, warn: 1, info: 2, success: 3, session: 4, scrape: 5, debug: 6, verbose: 7 },
  colors: { error: 'red', warn: 'yellow', info: 'cyan', success: 'green', session: 'magenta', scrape: 'blue', debug: 'white', verbose: 'gray' },
}

let logger: winston.Logger
let mainWindowRef: BrowserWindow | null = null
const buffer: LogEntry[] = []
const MAX_BUFFER = 600

/** Safely push to the renderer, skipping when the window/webContents is gone (closed or reloaded). */
function streamToRenderer(entry: LogEntry) {
  const win = mainWindowRef
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('log:stream', entry)
  }
}

/** Winston-backed logger that streams entries to the renderer and keeps a bounded in-memory history. */
export const Logger = {
  /**
   * Initialises winston transports (rotating file + console) and wires the
   * renderer stream.
   *
   * @param win - Window that receives log:stream events, or null when headless.
   */
  init(win: BrowserWindow | null) {
    mainWindowRef = win
    const logDir = app.getPath('logs')

    logger = winston.createLogger({
      levels: CUSTOM_LEVELS.levels,
      level: 'verbose',
      transports: [
        new winston.transports.File({
          filename: path.join(logDir, 'app.log'),
          maxsize: 10 * 1024 * 1024,
          maxFiles: 3,
          tailable: true,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize({ colors: CUSTOM_LEVELS.colors }),
            winston.format.simple()
          ),
        }),
      ],
    })

    logger.on('data', (chunk: LogEntry) => {
      streamToRenderer(chunk)
    })
  },

  /**
   * Logs an entry, buffers it, and pushes it to the renderer.
   *
   * @param level - Severity / category of the entry.
   * @param module - Originating subsystem shown in the log line.
   * @param message - Human-readable message.
   * @param meta - Optional structured context written to the file transport.
   */
  log(level: LogEntry['level'], module: string, message: string, meta?: Record<string, unknown>) {
    const entry: LogEntry = { ts: new Date().toISOString(), level, module, message, meta }
    ;(logger as unknown as Record<string, (msg: string, meta?: object) => void>)[level]?.(message, { module, ...meta })
    buffer.push(entry)
    if (buffer.length > MAX_BUFFER) buffer.shift()
    streamToRenderer(entry)
  },

  /**
   * Returns the buffered log history.
   *
   * @returns A snapshot copy of the recent entries.
   */
  getHistory(): LogEntry[] {
    return [...buffer]
  },

  /**
   * Clears the in-memory history and truncates the on-disk log file. The
   * file transport keeps appending afterwards, and its 10 MB rotation still
   * applies - this just resets the current contents.
   */
  clear() {
    buffer.length = 0
    try {
      fs.truncateSync(path.join(app.getPath('logs'), 'app.log'), 0)
    } catch {
      /* file may not exist yet */
    }
    Logger.info('logger', 'Logs cleared')
  },

  error: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('error', module, msg, meta),
  warn: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('warn', module, msg, meta),
  info: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('info', module, msg, meta),
  success: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('success', module, msg, meta),
  debug: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('debug', module, msg, meta),
  scrape: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('scrape', module, msg, meta),
  session: (module: string, msg: string, meta?: Record<string, unknown>) => Logger.log('session', module, msg, meta),
}
