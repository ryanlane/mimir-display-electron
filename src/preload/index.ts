import { contextBridge } from 'electron'

// Narrow, explicit API surface; extend as MQTT & caching implemented
contextBridge.exposeInMainWorld('mimirDisplay', {
  version: '0.1.0'
})

export {} // keep this a module
