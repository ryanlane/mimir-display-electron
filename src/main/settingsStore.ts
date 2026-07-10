import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Persisted admin settings (userData/settings.json) — the Electron
 * equivalent of the native Windows client's Settings dialog. Values are
 * applied as environment defaults before getConfig() runs, so explicit
 * env vars (kiosk provisioning, .env) always win over UI-saved settings.
 */

export interface AdminSettings {
  displayId?: string
  displayName?: string
  mqttUrl?: string
  mqttUsername?: string
  mqttPassword?: string
  apiUrl?: string
  startFullscreen?: boolean
}

const SETTINGS_ENV_MAP: Record<string, string> = {
  displayId: 'MIMIR_DISPLAY_ID',
  displayName: 'MIMIR_DISPLAY_NAME',
  mqttUrl: 'MIMIR_MQTT_URL',
  mqttUsername: 'MIMIR_MQTT_USERNAME',
  mqttPassword: 'MIMIR_MQTT_PASSWORD',
  apiUrl: 'MIMIR_API_URL'
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function readSettings(): AdminSettings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function writeSettings(next: AdminSettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
}

/** Apply saved settings as env-var defaults. Existing env vars win. */
export function applySettingsToEnv(settings: AdminSettings): void {
  for (const [key, envName] of Object.entries(SETTINGS_ENV_MAP)) {
    const value = (settings as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim() && !process.env[envName]) {
      process.env[envName] = value.trim()
    }
  }
}
