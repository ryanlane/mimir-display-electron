import { app, BrowserWindow, nativeImage, ipcMain, protocol, net, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import QRCode from 'qrcode'
import { getConfig, validateImageUrl } from '../shared/config.js'
import { detectContentKind } from '../shared/content.js'
import { MqttWorkerManager } from './mqttWorkerManager.js'
import { fetchWithCache, trimCache, getCacheDir } from './cache/imageCache.js'
import { startMdns, stopMdns } from './mdns.js'
import { readRegistration, writeRegistration, getLocalIp } from './registration.js'
import { generatePairCode, buildPairUrl } from '../shared/pairingUtils.js'
import { readSettings, writeSettings, applySettingsToEnv, type AdminSettings } from './settingsStore.js'
import { initFileLogger, getLogDir, logToFile } from './fileLogger.js'

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

// UI-saved settings act as env defaults (explicit env always wins), so they
// must be applied before the config is parsed.
const adminSettings = readSettings()
applySettingsToEnv(adminSettings)

const cfg = getConfig()

// Admin panel runtime state (parity with the native Windows client's menu)
let mqttConnected = false
const mqttTraffic: Array<{ direction: string; topic: string; snippet: string; ts: number }> = []
const MQTT_TRAFFIC_MAX = 300

// Pairing state — determined at startup before the window opens.
// pairCode is null when the display is already registered.
const registration = readRegistration()
const pairCode: string | null = registration.registered ? null : generatePairCode()
let pairQrDataUrl: string | null = null
let pairLocalIp: string = 'Unknown IP'

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
  const iconPath = path.join(__dirname, '../../build/mimir.png')
  win = new BrowserWindow({
    width: 800,
    height: 480,
    backgroundColor: '#000000',
    show: true,
    autoHideMenuBar: true,
    fullscreen: adminSettings.startFullscreen === true || process.env.MIMIR__FULLSCREEN === 'true',
    icon: iconPath,
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

app.whenReady().then(async () => {
  initFileLogger()
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
  mqttManager = new MqttWorkerManager({
    brokerUrl: cfg.mqttUrl,
    displayId: cfg.displayId,
    logLevel: cfg.logLevel,
    ...(cfg.mqttUsername ? { mqttUsername: cfg.mqttUsername, mqttPassword: cfg.mqttPassword } : {}),
    ...(pairCode ? { pairCode, apiUrl: cfg.apiUrl, displayName: cfg.displayName } : {}),
    ...(process.env.MIMIR_REG_TOKEN ? { regToken: process.env.MIMIR_REG_TOKEN } : {})
  })
  // mDNS advertisement (optional)
  startMdns(cfg)
  // Pre-generate pairing assets so IPC response is instant when renderer asks
  if (pairCode) {
    pairLocalIp = getLocalIp()
    const pairUrl = buildPairUrl(cfg.apiUrl, pairCode)
    if (pairUrl) {
      try {
        pairQrDataUrl = await QRCode.toDataURL(pairUrl, { width: 280, margin: 2, color: { dark: '#111827', light: '#ffffff' } })
      } catch (e: any) {
        console.warn('[pairing] QR generation failed:', e?.message)
      }
    }
  }

  mqttManager.on('event', async (evt: any) => {
    if (!win) return
    switch (evt.type) {
      case 'pairing_ack':
        win.webContents.send('display:pairingStatus', {
          status: evt.status,
          message: evt.message,
          isError: evt.status === 'error'
        })
        break
      case 'pairing_complete': {
        writeRegistration({
          registered: true,
          displayId: evt.displayId,
          registrationKey: evt.registrationKey,
          displayName: evt.displayName,
          displayLocation: evt.displayLocation,
          registeredAt: new Date().toISOString()
        })
        win.webContents.send('display:paired', { displayId: evt.displayId })
        break
      }
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
      case 'mqtt_state':
        mqttConnected = evt.connected
        win.webContents.send('display:mqttState', { connected: evt.connected })
        logToFile('info', `mqtt_state connected=${evt.connected}`)
        break
      case 'mqtt_traffic':
        mqttTraffic.push({ direction: evt.direction, topic: evt.topic, snippet: evt.snippet, ts: evt.ts })
        if (mqttTraffic.length > MQTT_TRAFFIC_MAX) mqttTraffic.shift()
        win.webContents.send('display:mqttTraffic', mqttTraffic[mqttTraffic.length - 1])
        break
      case 'log':
        if (cfg.logLevel === 'debug' || (cfg.logLevel === 'info' && evt.level !== 'debug')) {
          if (!app.isPackaged) console.log('[mqtt]', evt.level, evt.message)
        }
        logToFile(evt.level, evt.message)
        break
      case 'error':
        if (!app.isPackaged) console.warn('[mqtt-error]', evt.error)
        logToFile('error', evt.error)
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

// Renderer calls this on mount to decide whether to show the pairing splash.
// Returns null when the display is already registered.
ipcMain.handle('pairing:getInfo', () => {
  if (!pairCode) return null
  return {
    pairCode,
    qrDataUrl: pairQrDataUrl,
    displayId: cfg.displayId,
    apiUrl: cfg.apiUrl ?? null,
    ipAddress: pairLocalIp
  }
})

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

// ── Admin panel IPC (parity with the native Windows client's menu) ──────────

ipcMain.handle('admin:getStatus', () => ({
  deviceId: cfg.displayId,
  displayName: cfg.displayName ?? null,
  version: app.getVersion(),
  connected: mqttConnected,
  brokerUrl: cfg.mqttUrl,
  mqttUsername: cfg.mqttUsername ?? null,
  apiUrl: cfg.apiUrl ?? null,
  registered: registration.registered,
  pairCode: pairCode,
  resolution: win ? win.getContentSize() : null,
  fullscreen: win ? win.isFullScreen() : false,
  packaged: app.isPackaged,
  logDir: getLogDir()
}))

ipcMain.handle('admin:getTraffic', () => mqttTraffic)

ipcMain.handle('admin:clearCache', async () => {
  const cacheDir = getCacheDir()
  let cleared = 0
  try {
    const entries = await fs.readdir(cacheDir)
    for (const name of entries) {
      try { await fs.unlink(path.join(cacheDir, name)); cleared++ } catch { /* best effort */ }
    }
  } catch { /* cache dir may not exist yet */ }
  logToFile('info', `admin cleared cache (${cleared} files)`)
  return { cleared }
})

ipcMain.handle('admin:openLogs', async () => {
  const dir = getLogDir()
  await shell.openPath(dir)
  return { dir }
})

ipcMain.handle('admin:resetPairing', () => {
  // Same semantics as the Windows client's Reset Pairing: clear stored
  // identity, then relaunch so the pairing splash comes back up.
  writeRegistration({ registered: false })
  logToFile('info', 'admin reset pairing — relaunching')
  app.relaunch()
  app.exit(0)
  return { ok: true }
})

ipcMain.handle('admin:toggleFullscreen', () => {
  if (!win) return { fullscreen: false }
  win.setFullScreen(!win.isFullScreen())
  return { fullscreen: win.isFullScreen() }
})

ipcMain.handle('admin:quit', () => {
  logToFile('info', 'admin quit requested')
  gracefulExit()
  return { ok: true }
})

ipcMain.handle('admin:getSettings', () => readSettings())

ipcMain.handle('admin:saveSettings', (_e, next: AdminSettings) => {
  writeSettings(next || {})
  logToFile('info', 'admin settings saved — relaunching to apply')
  // Config is parsed once at startup; a relaunch is the honest way to apply.
  app.relaunch()
  app.exit(0)
  return { ok: true }
})

// Single-shot provision bundle: saves connection settings, clears pairing
// state, then relaunches so the display re-pairs with the new server.
ipcMain.handle('admin:applyProvision', (_e, bundle: {
  mqttUrl: string
  mqttUsername?: string
  mqttPassword?: string
  apiUrl?: string
  regToken?: string
}) => {
  const current = readSettings()
  writeSettings({ ...current, ...bundle })
  writeRegistration({ registered: false })
  logToFile('info', `provision bundle applied mqtt=${bundle.mqttUrl} — relaunching`)
  app.relaunch()
  app.exit(0)
  return { ok: true }
})

// Debug hook (like MIMIR_DEBUG_SCREENSHOT_DIR): opens the admin panel via a
// synthesized keypress and captures a frame — remote verification of the
// panel on headless/kiosk machines.
if (process.env.MIMIR_DEBUG_OPEN_ADMIN) {
  app.whenReady().then(() => {
    setTimeout(() => {
      if (!win) return
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F10' })
      const shotDir = process.env.MIMIR_DEBUG_SCREENSHOT_DIR
      if (shotDir) {
        setTimeout(async () => {
          try {
            const image = await win!.capturePage()
            await fs.writeFile(path.join(shotDir, `admin-panel-${Date.now()}.png`), image.toPNG())
            console.log('[display] admin panel screenshot saved')
          } catch { /* debug only */ }
        }, 3000)
      }
    }, 6000)
  })
}

// Handle external termination (installer sends WM_CLOSE or may kill process)
process.on('SIGTERM', () => gracefulExit())
process.on('SIGINT', () => gracefulExit())
