#!/usr/bin/env node
// Copy plain worker files (cjs/js) into dist. Optional --watch flag to poll for changes.
import { mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve('src/main/workers')
const outDir = path.resolve('dist/main/workers')

function runOnce() {
  try { mkdirSync(outDir, { recursive: true }) } catch {}
  for (const f of readdirSync(srcDir)) {
    if (f.endsWith('.cjs') || f.endsWith('.js')) {
      const full = path.join(srcDir, f)
      if (statSync(full).isFile()) {
        copyFileSync(full, path.join(outDir, f))
        console.log('[copy-workers] copied', f)
      }
    }
  }
}

runOnce()

if (process.argv.includes('--watch')) {
  setInterval(runOnce, 1500)
}
