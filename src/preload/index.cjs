'use strict'
// Sandboxed preload — MUST be CommonJS (Electron sandboxed preloads cannot
// use ESM import syntax; a tsc-emitted ESM file fails to load silently).
// Shipped as a hand-written .cjs and copied to dist, exactly like
// main/workers/mqttWorker.cjs.
const { contextBridge, ipcRenderer } = require('electron')

// Narrow, explicit API surface between the sandboxed renderer and main.
contextBridge.exposeInMainWorld('mimirDisplay', {
  version: '0.2.0',
  onSetContent: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('display:setContent', listener)
    return () => ipcRenderer.removeListener('display:setContent', listener)
  },
  onError: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('display:error', listener)
    return () => ipcRenderer.removeListener('display:error', listener)
  },
  // Renderer -> main: content finished loading (or failed). Powers logging
  // and the optional debug screenshot hook.
  contentReady: (payload) => {
    ipcRenderer.send('display:contentReady', payload)
  }
})
