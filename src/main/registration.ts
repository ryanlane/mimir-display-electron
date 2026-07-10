/**
 * Registration state persistence.
 * Stores registration.json in Electron's userData directory so the pairing
 * state survives restarts without requiring .env edits.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'

export interface RegistrationState {
  registered: boolean
  displayId?: string
  registrationKey?: string
  displayName?: string
  displayLocation?: string
  registeredAt?: string
}

function getRegistrationPath(): string {
  return join(app.getPath('userData'), 'registration.json')
}

export function readRegistration(): RegistrationState {
  const filePath = getRegistrationPath()
  if (!existsSync(filePath)) return { registered: false }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return parsed as RegistrationState
  } catch {
    return { registered: false }
  }
}

export function writeRegistration(state: RegistrationState): void {
  writeFileSync(getRegistrationPath(), JSON.stringify(state, null, 2), 'utf8')
}

export function clearRegistration(): void {
  writeRegistration({ registered: false })
}

/** Return the device's primary outbound LAN IP, or 'Unknown IP'. */
export function getLocalIp(): string {
  const ifaces = networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return 'Unknown IP'
}
