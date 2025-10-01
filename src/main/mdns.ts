import type { AppConfig } from '../shared/config.js'
import os from 'node:os'

let bonjourInstance: any = null
let service: any = null

export async function startMdns(cfg: AppConfig) {
  if (!cfg.mdnsEnable) return
  try {
    if (!bonjourInstance) {
      const mod: any = await import('bonjour-service')
      // Possible shapes:
      // 1. { default: [Function Bonjour] , Bonjour: [Function Bonjour], ... }
      // 2. { default: [Function factory], Bonjour: [Function Bonjour], ... }
      // 3. { Bonjour: [Function Bonjour], ... }
      const d = mod.default
      const ctorCandidate = mod.Bonjour || (typeof d === 'function' && d.prototype && Object.getOwnPropertyNames(d.prototype).includes('publish') ? d : null)
      if (ctorCandidate) {
        try {
          bonjourInstance = new ctorCandidate()
        } catch (err) {
          // Fallback: maybe default is a factory returning instance
          if (!bonjourInstance && typeof d === 'function') {
            try { bonjourInstance = d() } catch {}
          }
        }
      } else if (typeof d === 'function') {
        // Treat default as factory
        bonjourInstance = d()
      }
      if (!bonjourInstance || typeof bonjourInstance.publish !== 'function') {
        throw new Error('Unable to instantiate bonjour-service (no publish function)')
      }
    }
    const txt: Record<string, string> = {
      display_id: cfg.displayId,
      mqtt: cfg.mqttUrl,
      version: '0.1.0'
    }
    service = bonjourInstance.publish({
      name: `Mimir Display ${cfg.displayId}`,
      type: 'mimir-display',
      protocol: 'tcp',
      port: 53530,
      txt
    })
    service.on('up', () => { if (cfg.logLevel === 'debug') console.log('[mdns] service announced mimir-display', txt) })
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e)
    if ((cfg as any).logLevel === 'debug') {
      try {
        const mod: any = await import('bonjour-service')
        console.warn('[mdns] advertise failed', msg, 'export keys:', Object.keys(mod))
      } catch {}
    }
  }
}

export function stopMdns() {
  try { service?.stop(); service = null } catch {}
  try { bonjourInstance?.destroy(); bonjourInstance = null } catch {}
}
