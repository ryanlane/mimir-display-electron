import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Persistent file logging (userData/logs/display.log), active in packaged
 * builds too — packaged apps otherwise swallow every worker/main error,
 * which turns simple bugs into archaeology (see the duplicated-worker
 * SyntaxError incident).
 */

const MAX_BYTES = 1_000_000

let logFile: string | null = null

export function initFileLogger(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'display.log')
  // Simple size cap: start fresh once the file grows past the limit,
  // keeping one previous generation for context.
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_BYTES) {
      fs.renameSync(logFile, logFile + '.1')
    }
  } catch { /* rotation is best-effort */ }
  logToFile('info', `--- session start pid=${process.pid} version=${app.getVersion()} packaged=${app.isPackaged} ---`)
  return dir
}

export function getLogDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

export function logToFile(level: string, message: string): void {
  if (!logFile) return
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${message}\n`)
  } catch { /* never throw from logging */ }
}
