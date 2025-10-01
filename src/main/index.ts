import { app, BrowserWindow, nativeImage, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig, validateImageUrl } from '../shared/config.js'
import { MqttWorkerManager } from './mqttWorkerManager.js'
import { fetchWithCache, trimCache } from './cache/imageCache.js'
import { startMdns, stopMdns } from './mdns.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const cfg = getConfig()

// Ensure only one running instance (helps installer close prior one)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Focus existing window if another launch attempted
    if (BrowserWindow.getAllWindows().length) {
      const w = BrowserWindow.getAllWindows()[0]
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })
}

let win: BrowserWindow | null = null
let mqttManager: MqttWorkerManager | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 480,
    backgroundColor: '#000000',
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Provide a fallback dev server URL so Windows PowerShell runs (where env var syntax differs) still load the renderer.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173/' : undefined)
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    // In production load the built index.html from dist/renderer relative to dist/main
    const prodIndex = path.join(__dirname, '../renderer/index.html')
    win.loadFile(prodIndex)
  }

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  createWindow()
  mqttManager = new MqttWorkerManager({ brokerUrl: cfg.mqttUrl, displayId: cfg.displayId })
  // mDNS advertisement (optional)
  startMdns(cfg)
  mqttManager.on('event', async (evt: any) => {
    if (!win) return
    switch (evt.type) {
      case 'render_request': {
        if (!validateImageUrl(evt.delivery.url, cfg)) {
          win.webContents.send('display:error', { message: 'URL not allowed', assignmentId: evt.assignmentId })
          return
        }
        try {
          const result = await fetchWithCache({ url: evt.delivery.url, etag: evt.delivery.etag, ttlSeconds: evt.delivery.ttlSeconds, maxBytes: cfg.cacheMaxImageBytes })
          await trimCache(cfg.cacheMaxBytes)
          win.webContents.send('display:setImage', { url: 'file://' + result.filePath, assignmentId: evt.assignmentId, cached: result.fromCache })
        } catch (e: any) {
          win.webContents.send('display:error', { message: 'Cache fetch failed: ' + e.message, assignmentId: evt.assignmentId })
        }
        break
      }
      case 'log':
        if (cfg.logLevel === 'debug' || (cfg.logLevel === 'info' && evt.level !== 'debug')) {
          if (!app.isPackaged) console.log('[mqtt]', evt.level, evt.message)
        }
        break
      case 'error':
        if (!app.isPackaged) console.warn('[mqtt-error]', evt.error)
        win.webContents.send('display:error', { message: evt.error, assignmentId: evt.assignmentId })
        break
    }
  })
  mqttManager.start()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

// Graceful shutdown helper so installer / uninstaller can terminate quickly
async function gracefulExit() {
  try { mqttManager?.stop() } catch {}
  try { stopMdns() } catch {}
  // Force terminate worker & exit quicker for installer
  setTimeout(() => { app.exit(0) }, 300).unref()
}

app.on('window-all-closed', () => {
  gracefulExit()
})

ipcMain.handle('app:shutdown', async () => { gracefulExit(); return { ok: true } })

// Handle external termination (installer sends WM_CLOSE or may kill process)
process.on('SIGTERM', () => gracefulExit())
process.on('SIGINT', () => gracefulExit())
