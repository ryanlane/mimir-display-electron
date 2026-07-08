#!/usr/bin/env node
// Copy worker files (cjs/js) into dist and optionally watch for changes.
// Exits immediately if no --watch flag (for build step). When --watch is provided, keeps the process alive.
import { mkdirSync, copyFileSync, readdirSync, statSync, watch } from 'node:fs'
import path from 'node:path'

// [srcDir, outDir] pairs of hand-written CJS that bypasses tsc: worker
// threads and the sandboxed preload (which cannot be ESM).
const COPY_DIRS = [
  [path.resolve('src/main/workers'), path.resolve('dist/main/workers')],
  [path.resolve('src/preload'), path.resolve('dist/preload')]
]

function log(msg) { console.log('[copy-workers]', msg) }

function copyDir(srcDir, outDir) {
  try { mkdirSync(outDir, { recursive: true }) } catch {}
  let copied = 0
  for (const f of readdirSync(srcDir)) {
    if (!/\.(cjs|js)$/.test(f)) continue
    const full = path.join(srcDir, f)
    try {
      if (statSync(full).isFile()) {
        copyFileSync(full, path.join(outDir, f))
        copied++
      }
    } catch {}
  }
  return copied
}

function copyAll() {
  let copied = 0
  for (const [srcDir, outDir] of COPY_DIRS) copied += copyDir(srcDir, outDir)
  log(copied ? `copied ${copied} file(s)` : 'no changes')
}

const watching = process.argv.includes('--watch')
copyAll()
if (watching) {
  for (const [srcDir] of COPY_DIRS) {
    try {
      watch(srcDir, { persistent: true }, (_evt, filename) => {
        if (filename && /\.(cjs|js)$/.test(filename)) {
          copyAll()
        }
      })
    } catch (e) {
      log('watch error ' + e.message)
    }
  }
  log('watching...')
}