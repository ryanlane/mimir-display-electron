import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { createWriteStream, promises as fsp } from 'node:fs'
import http from 'node:http'
import https from 'node:https'

export interface CacheFetchOptions {
  url: string
  etag?: string
  ttlSeconds?: number
  contentTypeHint?: string
  timeoutMs?: number
  maxBytes?: number
}

interface CacheMeta {
  url: string
  etag?: string
  ttlSeconds?: number
  storedAt: number
  lastAccess: number
  contentType?: string
  bytes: number
}

export interface CacheResult {
  filePath: string
  fromCache: boolean
  meta: CacheMeta
}

const CACHE_DIR = path.join(app.getPath('userData'), 'cache')
const META_EXT = '.json'

async function ensureDir() { await fs.mkdir(CACHE_DIR, { recursive: true }) }

function hashUrl(url: string) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

function deriveExt(contentType?: string, url?: string) {
  if (contentType) {
    if (contentType.includes('png')) return '.png'
    if (contentType.includes('jpeg')) return '.jpg'
    if (contentType.includes('jpg')) return '.jpg'
    if (contentType.includes('webp')) return '.webp'
    if (contentType.includes('gif')) return '.gif'
  }
  const m = url?.match(/\.(png|jpe?g|webp|gif)(\?|#|$)/i)
  if (m) return '.' + m[1].toLowerCase().replace('jpeg', 'jpg')
  return '.img'
}

async function readMeta(metaPath: string): Promise<CacheMeta | null> {
  try {
    const raw = await fs.readFile(metaPath, 'utf8')
    return JSON.parse(raw)
  } catch { return null }
}

async function writeMeta(metaPath: string, meta: CacheMeta) {
  await fs.writeFile(metaPath, JSON.stringify(meta), 'utf8')
}

function httpGet(url: string, timeoutMs: number): Promise<{ stream: NodeJS.ReadableStream; headers: any }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error('HTTP ' + res.statusCode))
        res.resume()
        return
      }
      resolve({ stream: res, headers: res.headers })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')) })
  })
}

export async function fetchWithCache(opts: CacheFetchOptions): Promise<CacheResult> {
  await ensureDir()
  const h = hashUrl(opts.url)
  const metaPath = path.join(CACHE_DIR, h + META_EXT)
  let meta = await readMeta(metaPath)
  const now = Date.now()
  if (meta && meta.url === opts.url) {
    const expired = meta.ttlSeconds ? meta.storedAt + meta.ttlSeconds * 1000 < now : false
    if (!expired) {
      meta.lastAccess = now
      await writeMeta(metaPath, meta)
      return { filePath: path.join(CACHE_DIR, h + deriveExt(meta.contentType, meta.url)), fromCache: true, meta }
    }
  }

  // Download fresh
  const timeout = opts.timeoutMs ?? 15000
  const maxBytes = opts.maxBytes ?? 5_000_000
  const { stream, headers } = await httpGet(opts.url, timeout)
  const contentType = headers['content-type'] as string | undefined
  const etagHeader = headers['etag'] as string | undefined
  const ext = deriveExt(contentType, opts.url)
  const filePath = path.join(CACHE_DIR, h + ext)
  const tmpPath = filePath + '.part'
  let bytes = 0
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(tmpPath)
    stream.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        // Use optional destroy to satisfy broader stream typings
        ;(stream as any).destroy?.(new Error('size_exceeded'))
      }
    })
    stream.on('error', reject)
    ws.on('error', reject)
    stream.pipe(ws)
    ws.on('finish', () => resolve())
  })
  await fs.rename(tmpPath, filePath)
  meta = {
    url: opts.url,
    etag: etagHeader || opts.etag,
    ttlSeconds: opts.ttlSeconds,
    storedAt: now,
    lastAccess: now,
    contentType,
    bytes
  }
  await writeMeta(metaPath, meta)
  return { filePath, fromCache: false, meta }
}

export async function trimCache(maxTotalBytes = 50_000_000) {
  await ensureDir()
  const files = await fs.readdir(CACHE_DIR)
  interface CacheIndexed extends CacheMeta { metaPath: string; filePath: string }
  const metas: CacheIndexed[] = []
  let total = 0
  for (const f of files) {
    if (f.endsWith(META_EXT)) {
      const m = await readMeta(path.join(CACHE_DIR, f))
      if (!m) continue
      const h = f.slice(0, -META_EXT.length)
      const fileCandidates = files.filter(x => x.startsWith(h) && !x.endsWith(META_EXT))
      const filePath = fileCandidates.length ? path.join(CACHE_DIR, fileCandidates[0]) : ''
      const indexed: CacheIndexed = { ...m, metaPath: path.join(CACHE_DIR, f), filePath }
      metas.push(indexed)
      total += indexed.bytes || 0
    }
  }
  if (total <= maxTotalBytes) return
  metas.sort((a, b) => a.lastAccess - b.lastAccess)
  for (const m of metas) {
    if (total <= maxTotalBytes) break
    try { if (m.filePath) await fs.unlink(m.filePath) } catch {}
    try { await fs.unlink(m.metaPath) } catch {}
    total -= m.bytes || 0
  }
}
