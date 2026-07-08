import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Derive __dirname in ESM context (NodeNext) so this config works consistently across platforms
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// We set the Vite root to the renderer directory so the app is served at http://localhost:5173/
// This makes browser testing simpler (no nested /src/renderer path) and fixes the user's 404 at the root.
export default defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  // If port 5173 is already in use Vite will currently exit (strictPort: true) which causes the dev pipeline to stop.
  // If you frequently have a stale process holding the port, you can set strictPort: false and update the Electron
  // dev startup logic to read the chosen port dynamically.
  // Allow fallback port if 5173 is occupied so the dev process doesn't exit with code 1.
  server: { port: 5173, strictPort: false },
  build: {
    // Output still goes to the monorepo-style dist folder beside main/preload output
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: false // don't let Vite try to clean outside its root
  },
  // Vitest: the Vite root points at src/renderer for dev-server ergonomics,
  // but tests live across src/ (shared helpers included).
  test: {
    dir: path.resolve(__dirname, 'src')
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer')
    }
  }
})
