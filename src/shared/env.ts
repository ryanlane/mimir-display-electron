import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

export function loadEnv() {
  const root = process.cwd()
  const envFiles = [
    '.env.local',
    '.env'
  ]
  for (const f of envFiles) {
    const p = path.join(root, f)
    if (fs.existsSync(p)) {
      dotenv.config({ path: p })
    }
  }
}

export function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v == null) throw new Error(`Missing required env var ${name}`)
  return v
}
