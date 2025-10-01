#!/usr/bin/env node
// Copy worker files (cjs/js) into dist and optionally watch for changes.
// Exits immediately if no --watch flag (for build step). When --watch is provided, keeps the process alive.
import { mkdirSync, copyFileSync, readdirSync, statSync, watch } from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve('src/main/workers')
const outDir = path.resolve('dist/main/workers')

function log(msg) { console.log('[copy-workers]', msg) }

function copyAll() {
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
  if (copied) {
    log(`copied ${copied} file(s)`) 
  } else {
    log('no changes')
  }
}

const watching = process.argv.includes('--watch')
copyAll()
if (watching) {
  try {
    watch(srcDir, { persistent: true }, (_evt, filename) => {
      if (filename && /\.(cjs|js)$/.test(filename)) {
        copyAll()
      }
    })
    log('watching...')
  } catch (e) {
    log('watch error ' + e.message)
  }
}