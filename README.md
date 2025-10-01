# Mimir Display Electron (Vue + Vite)

Early scaffold for the Mimir display client.

## Dev Quick Start

```bash
# install deps
npm install

# run dev (renderer + typecheck + electron)
npm run dev
```
Renderer dev server runs on `http://localhost:5173` (opened inside Electron window). 

## Structure
```
src/
  main/        # Electron main process
  preload/     # Secure bridge (contextIsolation)
  renderer/    # Vue 3 fullscreen image UI
  shared/      # Env & shared utilities
```

## Next Steps
- Add MQTT client in main (or isolated worker) and forward display state via IPC.
- Implement command dispatcher & caching.
- Add mDNS advertisement.
- Harden CSP / security flags.

## License
MIT
