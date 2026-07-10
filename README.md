# Mimir Display Electron (Vue + Vite)

Electron-based Mimir display client for image/video rendering over MQTT.

This client is designed to run on desktop-class displays and mirrors the
platform MQTT contract used by the server and other display implementations.

## What This App Does

- Connects to MQTT and subscribes to `mimir/<display_id>/cmd`
- Validates inbound commands with Zod schemas in an isolated MQTT worker
- Sends device events to `mimir/<display_id>/evt` (`ack`, `rendered`, `error`, `presence`)
- Renders images and videos in a fullscreen Vue renderer
- Caches image content on disk and serves it to the renderer via `mimir-cache://`
- Publishes retained online status and periodic presence updates
- Optionally advertises via mDNS (`bonjour-service`)

## Current Command Support

Supported command types:

- `assign`
- `display_image`
- `refresh` (acknowledged as noop)
- `set_scene` (ack only)
- `clear_scene` (ack only)
- `register` (responds to `reply_to` with capabilities/metadata)
- `ready`
- `registration_complete`

Current gap:

- `finalize_registration` is not yet part of the Electron worker schema/handler.

## Dev Quick Start

```bash
# install dependencies
npm install

# run renderer + typecheck + main watch + worker copy + electron
npm run dev
```

Renderer dev server runs on `http://localhost:5173` and is loaded inside Electron.

## Build, Test, Package

```bash
# type checks (vue-tsc + tsc)
npm run lint:typecheck

# unit tests
npm test

# production build
npm run build

# desktop package (nsis/appimage/etc via electron-builder)
npm run package
```

## Build Release Executables

The app uses `electron-builder` and writes release artifacts to the `release/`
directory.

### 1. Build on the target OS

Build each executable on its target platform when possible:

- Build Windows installer on Windows
- Build Linux AppImage on Linux
- Build macOS app on macOS

### 2. Install dependencies

```bash
npm install
```

### 3. Build platform-specific release artifacts

```bash
# Current host defaults from package.json build config
npm run package

# Windows NSIS installer (native Windows shell)
npm run package -- --win nsis

# Windows NSIS installer from WSL/Linux (no Wine required)
npx electron-builder --win nsis --config.win.signAndEditExecutable=false

# Linux AppImage
npm run package -- --linux AppImage

# macOS app bundle / dmg target (if configured in your environment)
npm run package -- --mac
```

### 4. Find outputs

- Installers and packaged artifacts: `release/`
- Unpacked test build (example): `release/win-unpacked/`

### 4.1 WSL/Linux note for Windows targets

If you run the Windows build from WSL/Linux and see:

- `wine is required`

use the fallback command above with `--config.win.signAndEditExecutable=false`,
or run the Windows build from a native Windows terminal.

### 5. Smoke test before publishing

After building, launch the packaged app and verify:

- It starts without dev server dependencies
- It connects to the MQTT broker
- It receives and renders a `display_image` command
- It emits `ack` / `rendered` events

## Configuration

Environment is loaded from `.env.local` then `.env`.

### Required/Important Variables

| Variable           | Default                 | Notes                            |
| ------------------ | ----------------------- | -------------------------------- |
| `MIMIR_DISPLAY_ID` | `electron-display-01`   | Device topic id                  |
| `MIMIR_MQTT_URL`   | `mqtt://localhost:1883` | MQTT broker URL                  |
| `MIMIR_LOG_LEVEL`  | `info`                  | `debug`, `info`, `warn`, `error` |

### Content + Security

| Variable                      | Default    | Notes                                                         |
| ----------------------------- | ---------- | ------------------------------------------------------------- |
| `MIMIR_ALLOW_UNSAFE_HTTP`     | `false`    | If false, image URLs must be `https`                          |
| `MIMIR_IMAGE_URL_ALLOWLIST`   | unset      | Comma-separated hostnames/patterns (supports `*.example.com`) |
| `MIMIR_CACHE_MAX_BYTES`       | `50000000` | Total cache budget                                            |
| `MIMIR_CACHE_MAX_IMAGE_BYTES` | `5000000`  | Per-image max size                                            |

### Runtime Behavior

| Variable                     | Default | Notes                                                       |
| ---------------------------- | ------- | ----------------------------------------------------------- |
| `MIMIR_PRESENCE_INTERVAL_S`  | `60`    | Presence interval in config layer                           |
| `MIMIR_MDNS_ENABLE`          | `false` | Enable mDNS advertisement                                   |
| `MIMIR_DEBUG_SCREENSHOT_DIR` | unset   | If set, captures screenshots after successful content loads |

## Media Notes

- Images are downloaded/cached and then displayed from `mimir-cache://...`
- Video is streamed directly (not cached) to the renderer `<video>` element
- The worker advertises support for `webm` video format
- Electron does not include proprietary codecs by default, so source content
  should prefer royalty-free browser-compatible formats

## Architecture

```text
src/
  main/
    index.ts                 Electron bootstrap + IPC + cache delivery
    mqttWorkerManager.ts     Worker lifecycle + restart handling
    workers/mqttWorker.cjs   MQTT connection + command validation/dispatch
    cache/imageCache.ts      URL fetch + cache + trim logic
    mdns.ts                  Optional mDNS announce
  preload/
    index.cjs                Secure bridge (contextIsolation)
  renderer/
    DisplayApp.vue           Fullscreen image/video renderer
  shared/
    config.ts                Env parsing + validation
    content.ts               Media kind detection
    types/mqttSchemas.ts     Zod schemas for MQTT protocol
```

## MQTT Topics Used

- Inbound commands: `mimir/<display_id>/cmd`
- Outbound events: `mimir/<display_id>/evt`
- Retained status: `mimir/<display_id>/status`
- Registration request bus: `mimir/registry/register`
- Optional mDNS pairing helper topic usage stays outside main display pipeline

## Troubleshooting

- App shows "URL not allowed": check `MIMIR_ALLOW_UNSAFE_HTTP` and
  `MIMIR_IMAGE_URL_ALLOWLIST`
- No renderer updates: confirm broker connectivity and command topic target id
- Commands rejected as invalid: inspect schema in
  `src/shared/types/mqttSchemas.ts`
- Worker restart loops: check main process logs for MQTT/auth/url errors

## License

MIT
