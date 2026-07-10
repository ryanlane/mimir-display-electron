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
  },
  // Pairing flow
  getPairingInfo: () => ipcRenderer.invoke('pairing:getInfo'),
  onPairingStatus: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('display:pairingStatus', listener)
    return () => ipcRenderer.removeListener('display:pairingStatus', listener)
  },
  onPaired: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('display:paired', listener)
    return () => ipcRenderer.removeListener('display:paired', listener)
  },

  // Admin panel — parity with the native Windows client's menu
  admin: {
    getStatus: () => ipcRenderer.invoke('admin:getStatus'),
    getTraffic: () => ipcRenderer.invoke('admin:getTraffic'),
    onTraffic: (cb) => {
      const listener = (_e, entry) => cb(entry)
      ipcRenderer.on('display:mqttTraffic', listener)
      return () => ipcRenderer.removeListener('display:mqttTraffic', listener)
    },
    onMqttState: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on('display:mqttState', listener)
      return () => ipcRenderer.removeListener('display:mqttState', listener)
    },
    clearCache: () => ipcRenderer.invoke('admin:clearCache'),
    openLogs: () => ipcRenderer.invoke('admin:openLogs'),
    resetPairing: () => ipcRenderer.invoke('admin:resetPairing'),
    toggleFullscreen: () => ipcRenderer.invoke('admin:toggleFullscreen'),
    quit: () => ipcRenderer.invoke('admin:quit'),
    getSettings: () => ipcRenderer.invoke('admin:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('admin:saveSettings', settings),
    applyProvision: (bundle) => ipcRenderer.invoke('admin:applyProvision', bundle)
  }
})
