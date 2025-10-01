import { z } from 'zod'
import { loadEnv } from './env.js'

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  MIMIR_DISPLAY_ID: z.string().min(1).default('electron-display-01'),
  MIMIR_MQTT_URL: z.string().url().default('mqtt://localhost:1883'),
  MIMIR_PRESENCE_INTERVAL_S: z.coerce.number().int().min(10).max(3600).default(60),
  MIMIR_CACHE_MAX_BYTES: z.coerce.number().int().min(1_000_000).max(500_000_000).default(50_000_000),
  MIMIR_CACHE_MAX_IMAGE_BYTES: z.coerce.number().int().min(100_000).max(50_000_000).default(5_000_000),
  MIMIR_LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info'),
  MIMIR_ALLOW_UNSAFE_HTTP: z.coerce.boolean().default(false),
  MIMIR_IMAGE_URL_ALLOWLIST: z.string().optional(), // comma-separated host patterns
  MIMIR_MDNS_ENABLE: z.coerce.boolean().default(false)
})

type RawConfig = z.infer<typeof schema>

export interface AppConfig {
  env: string
  displayId: string
  mqttUrl: string
  presenceIntervalMs: number
  cacheMaxBytes: number
  cacheMaxImageBytes: number
  logLevel: RawConfig['MIMIR_LOG_LEVEL']
  allowUnsafeHttp: boolean
  imageUrlAllowlist: string[] | null
  mdnsEnable: boolean
}

let cached: AppConfig | null = null

export function getConfig(): AppConfig {
  if (cached) return cached
  loadEnv()
  const parsed = schema.parse(process.env)
  cached = {
    env: parsed.NODE_ENV,
    displayId: parsed.MIMIR_DISPLAY_ID,
    mqttUrl: parsed.MIMIR_MQTT_URL,
    presenceIntervalMs: parsed.MIMIR_PRESENCE_INTERVAL_S * 1000,
    cacheMaxBytes: parsed.MIMIR_CACHE_MAX_BYTES,
    cacheMaxImageBytes: parsed.MIMIR_CACHE_MAX_IMAGE_BYTES,
    logLevel: parsed.MIMIR_LOG_LEVEL,
    allowUnsafeHttp: parsed.MIMIR_ALLOW_UNSAFE_HTTP,
    imageUrlAllowlist: parsed.MIMIR_IMAGE_URL_ALLOWLIST ? parsed.MIMIR_IMAGE_URL_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean) : null,
    mdnsEnable: parsed.MIMIR_MDNS_ENABLE
  }
  return cached
}

export function validateImageUrl(url: string, cfg: AppConfig): boolean {
  try {
    const u = new URL(url)
    if (!cfg.allowUnsafeHttp && u.protocol !== 'https:') return false
    if (!cfg.imageUrlAllowlist || cfg.imageUrlAllowlist.length === 0) return true
    return cfg.imageUrlAllowlist.some(pattern => {
      if (pattern === '*') return true
      // simple wildcard: *.example.com
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2)
        return u.hostname === suffix || u.hostname.endsWith('.' + suffix)
      }
      return u.hostname === pattern
    })
  } catch { return false }
}
