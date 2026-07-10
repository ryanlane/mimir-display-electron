import { randomBytes } from 'node:crypto'

/** Unambiguous alphabet — matches the server's PAIR_ALPHABET exactly. */
export const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Generate a cryptographically random pairing code.
 * Called only from the main process (Node.js ESM context).
 */
export function generatePairCode(length = 6): string {
  const buf = randomBytes(length)
  return Array.from(buf, b => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join('')
}

/**
 * Build the URL to encode in the pairing QR code.
 * Returns null if apiUrl is not configured.
 */
export function buildPairUrl(apiUrl: string | null | undefined, pairCode: string): string | null {
  if (!apiUrl) return null
  return `${apiUrl.replace(/\/+$/, '')}/displays?pair=${pairCode}`
}
