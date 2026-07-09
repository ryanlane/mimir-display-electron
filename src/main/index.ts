import { app, BrowserWindow, nativeImage, ipcMain, protocol, net } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getConfig, validateImageUrl } from '../shared/config.js'
import { detectContentKind } from '../shared/content.js'
import { MqttWorkerManager } from './mqttWorkerManager.js'
import { fetchWithCache, trimCache, getCacheDir } from './cache/imageCache.js'
import { startMdns, stopMdns } from './mdns.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

// Displays have no user gestures — allow muted/unmuted autoplay outright.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Cached content is served to the renderer via mimir-cache:// — Chromium
// hard-blocks file:// subresources on http(s)-served pages (dev server),
// so a custom scheme is the only path that works in both dev and prod.
protocol.registerSchemesAsPrivileged([
  { scheme: 'mimir-cache', privileges: { standard: false, secure: true, supportFetchAPI: false, stream: true } }
])

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
      preload: path.join(__dirname, '../preload/index.cjs'),
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

  // Report the actual content size to the server — dynamic displays must
  // receive renders matching their live window size, not the size they had
  // at registration. Debounced: resize fires continuously during a drag.
  let resizeTimer: NodeJS.Timeout | null = null
  const reportResolution = () => {
    if (!win || !mqttManager) return
    const [w, h] = win.getContentSize()
    mqttManager.send({ type: 'update_capabilities', capabilities: { resolution: [w, h] } })
  }
  win.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(reportResolution, 750)
  })
  // Initial report once the window exists (worker may still be connecting;
  // it also announces capabilities on connect, so this is belt-and-braces).
  setTimeout(reportResolution, 2000)

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  // mimir-cache://<basename> → file inside the image cache dir, and nothing
  // else — path traversal resolves outside the cache dir and is refused.
  protocol.handle('mimir-cache', (request) => {
    const cacheDir = getCacheDir()
    const basename = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, '') || new URL(request.url).hostname)
    const resolved = path.resolve(cacheDir, basename)
    if (!resolved.startsWith(cacheDir + path.sep)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(resolved).toString())
  })
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
        const kind = detectContentKind(evt.delivery.contentType, evt.delivery.url)
        if (kind === 'video') {
          // Stream directly from the source — video is played, not
          // downloaded: the <video> element issues range requests itself,
          // and multi-MB files don't belong in the image cache.
          win.webContents.send('display:setContent', {
            kind: 'video',
            url: evt.delivery.url,
            assignmentId: evt.assignmentId,
            loop: evt.delivery.loop !== false,   // default: loop
            muted: evt.delivery.muted !== false  // default: muted
          })
          break
        }
        try {
          const result = await fetchWithCache({ url: evt.delivery.url, etag: evt.delivery.etag, ttlSeconds: evt.delivery.ttlSeconds, maxBytes: cfg.cacheMaxImageBytes })
          await trimCache(cfg.cacheMaxBytes)
          win.webContents.send('display:setContent', { kind: 'image', url: 'mimir-cache://' + encodeURIComponent(path.basename(result.filePath)), assignmentId: evt.assignmentId, cached: result.fromCache })
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

// Renderer reports content load results. Logged in dev; when
// MIMIR_DEBUG_SCREENSHOT_DIR is set, a frame is captured shortly after each
// successful load — invaluable for verifying a headless display remotely.
ipcMain.on('display:contentReady', async (_e, payload: { kind: string; url: string; ok: boolean; detail?: string }) => {
  if (!app.isPackaged) console.log('[display]', payload.ok ? 'ready' : 'failed', payload.kind, payload.detail || payload.url)
  const shotDir = process.env.MIMIR_DEBUG_SCREENSHOT_DIR
  if (shotDir && payload.ok && win) {
    setTimeout(async () => {
      try {
        const image = await win!.capturePage()
        const file = path.join(shotDir, `display-${Date.now()}-${payload.kind}.png`)
        await fs.writeFile(file, image.toPNG())
        console.log('[display] debug screenshot:', file)
      } catch (err: any) {
        console.warn('[display] screenshot failed:', err?.message)
      }
    }, 1500)
  }
})

// Handle external termination (installer sends WM_CLOSE or may kill process)
process.on('SIGTERM', () => gracefulExit())
process.on('SIGINT', () => gracefulExit())
