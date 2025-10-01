# Mimir Display Integration Specification

A practical guide for building a custom display client (any hardware, any OS) that interoperates with the Mimir platform using the same MQTT command protocol implemented by the reference Inky e‑ink client.

---
## 1. Goals
Your custom client should be able to:
1. Register itself (or be pre-configured) with the Mimir platform
2. Maintain an MQTT connection and subscribe to command topics
3. Receive scene assignment & content commands
4. Download / render / cache images (or other media) locally
5. Acknowledge lifecycle events (ack, rendered, error)
6. Optionally participate in presence / heartbeat and discovery mechanisms
7. Handle both push and scheduled (polling) update strategies gracefully

---
## 2. High-Level Architecture
```
+----------------------+           +---------------------------+
|  Mimir API Service   |  MQTT     |   Custom Display Client   |
|  (publisher)         |<-------->|  (subscriber + event pub) |
+----------+-----------+           +-------------+-------------+
           |                                        |
           | REST (optional registration)           | Local Rendering / Hardware
           v                                        v
     Content Sources (Channels)                Frame / LCD / OLED / Browser
```

Core communication is **unidirectional commands** from service -> display, and **event acknowledgments** from display -> service.

---
## 3. MQTT Topic Convention
| Purpose | Direction | Topic Pattern | Notes |
|---------|-----------|---------------|-------|
| Commands to display | Service → Display | `mimir/<display_id>/cmd` | JSON command objects |
| Events from display | Display → Service | `mimir/<display_id>/evt` | ACK, rendered, error |
| Presence / heartbeat (optional) | Display → Service | `mimir/<display_id>/presence` | JSON status, interval based |
| Registration reply (dynamic) | Display → Service | Provided `reply_to` in `register` request | One-shot response |

Your client MUST subscribe to `mimir/<display_id>/cmd` and SHOULD publish events to `mimir/<display_id>/evt`.

---
## 4. Command Types
| Type | Sent When | Required Fields | Description |
|------|-----------|-----------------|-------------|
| `assign` | New content assigned | `assignment_id`, `scene_id`, `content.delivery` | Full assignment including content metadata |
| `display_image` | Direct image push (stateless) | `assignment_id`, `image_url` | Render this image now |
| `set_scene` | Scene context change | `assignment_id`, `scene_id` | Client should track current scene |
| `clear_scene` | Scene context cleared | `assignment_id` | Remove current scene reference |
| `refresh` | Prompt to fetch/update content | `assignment_id` | Usually triggers re-fetch sequence |
| `register` | Platform requests device capabilities | `reply_to` | Response must be published to reply topic |
| `ready` / `registration_complete` | Lifecycle | `assignment_id` | Informational / ack flow |

### 4.1 Assign Command Schema (example)
```json
{
  "type": "assign",
  "assignment_id": "mqtt-a1b2c3d4",
  "sequence": 3,
  "scene_id": "scene-123",
  "scene_name": "Lobby Feed",
  "display": {"id": "lobby-screen-01"},
  "content": {
    "delivery": {
      "type": "url",
      "url": "https://cdn.example.com/cache/img_abc123.png",
      "content_type": "image/png",
      "etag": "W/\"9af-abc\"",
      "ttl_seconds": 900
    },
    "metadata": {"caption": "Daily Headline"}
  },
  "update_type": "scheduled",        // "push" or "scheduled"
  "refresh_interval_s": 300,          // Present only if scheduled
  "timestamp": "2025-09-27T12:34:56.123456Z"
}
```

### 4.2 Display Image Command
Simpler direct-render instruction (no content cache semantics enforced by service):
```json
{
  "type": "display_image",
  "assignment_id": "disp-55aa11",
  "image_url": "https://cdn.example.com/current/frame.png",
  "timestamp": "2025-09-27T12:40:00Z"
}
```
Use when your client only needs a lightweight display update.

---
## 5. Event Types (Client → Service)
| Type | Purpose | Important Fields |
|------|---------|------------------|
| `ack` | Command receipt / basic success | `assignment_id`, optional `message` |
| `rendered` | Content fully processed & displayed | `assignment_id`, `duration_ms` |
| `error` | Error in processing or rendering | `assignment_id`, `error_type`, `message` |
| `presence` | Heartbeat/status | Implementation-defined (uptime, capabilities, scene) |

### 5.1 ACK Event Example
```json
{
  "type": "ack",
  "assignment_id": "mqtt-a1b2c3d4",
  "ok": true,
  "timestamp": "2025-09-27T12:34:56.789Z",
  "message": "Assignment accepted"
}
```

### 5.2 Rendered Event
```json
{
  "type": "rendered",
  "assignment_id": "mqtt-a1b2c3d4",
  "timestamp": "2025-09-27T12:34:57.200Z",
  "duration_ms": 411
}
```

### 5.3 Error Event
```json
{
  "type": "error",
  "assignment_id": "mqtt-a1b2c3d4",
  "timestamp": "2025-09-27T12:34:56.900Z",
  "error_type": "download_failed",
  "message": "HTTP 404 while fetching image"
}
```

---
## 6. Update Strategies
The server sends scheduling hints:
- `update_type = "push"`: Service will push new `assign` or `display_image` commands—client does not poll.
- `update_type = "scheduled"`: Client SHOULD poll or send a `refresh` request roughly every `refresh_interval_s` seconds if no new content arrives.

Your client MAY implement:
```pseudo
if update_type == "scheduled" and refresh_interval_s:
    schedule(task=send_refresh_command, every=refresh_interval_s)
```
Or simply wait for future assignments if minimalism is preferred.

---
## 7. Minimal Python Client Skeleton
```python
import asyncio, json, logging, uuid
from datetime import datetime, timezone
from aiomqtt import Client

BROKER_HOST = "localhost"
DISPLAY_ID = "custom-display-01"
CMD_TOPIC = f"mimir/{DISPLAY_ID}/cmd"
EVT_TOPIC = f"mimir/{DISPLAY_ID}/evt"

logger = logging.getLogger("custom_display")

async def publish_event(client, event):
    event.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    await client.publish(EVT_TOPIC, json.dumps(event), qos=1)

async def handle_assign(cmd):
    assignment_id = cmd.get("assignment_id")
    await publish_event(client, {"type": "ack", "assignment_id": assignment_id, "ok": True})
    # Download + render (pseudo)
    # image_url = cmd["content"]["delivery"]["url"]
    # render_image(download(image_url))
    await publish_event(client, {"type": "rendered", "assignment_id": assignment_id, "duration_ms": 250})

HANDLERS = {
    "assign": handle_assign,
    "display_image": handle_assign,  # reuse same flow; adjust as needed
}

async def main():
    async with Client(hostname=BROKER_HOST, port=1883) as client:
        await client.subscribe(CMD_TOPIC, qos=1)
        async for message in client.messages:
            try:
                cmd = json.loads(message.payload.decode())
                t = cmd.get("type")
                if t in HANDLERS:
                    await HANDLERS[t](cmd)
                else:
                    await publish_event(client, {"type": "error", "assignment_id": cmd.get("assignment_id"), "error_type": "unknown_command", "message": f"No handler: {t}"})
            except Exception as e:  # noqa: BLE001 simplified
                await publish_event(client, {"type": "error", "error_type": "processing", "message": str(e)})

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
```

---
## 8. Language-Agnostic Protocol Notes
- **Encoding**: All MQTT payloads are UTF‑8 JSON objects.
- **QoS**: Reference client uses QoS 1 for commands and events (at-least-once). You may choose QoS 0 if bandwidth constrained, but reliability decreases.
- **Idempotency**: `assignment_id` + `sequence` (when present) can be used to dedupe repeated messages.
- **Clock Drift**: Timestamps are for diagnostics only; server does not require tight sync.
- **Retention**: Commands are generally non-retained. Do not rely on retained state unless coordinated.

---
## 9. Presence / Heartbeat (Optional)
Recommended payload published every 30–120 seconds to `mimir/<display_id>/presence`:
```json
{
  "device_id": "custom-display-01",
  "scene_id": "scene-123",
  "uptime_s": 8450,
  "last_assignment_id": "mqtt-a1b2c3d4",
  "capabilities": {"render_modes": ["image/png"]},
  "status": {"online": true}
}
```
This helps the platform UI show live device state.

---
## 10. Registration Flow (Optional Dynamic Mode)
If the service sends a `register` command:
```json
{"type": "register", "reply_to": "mimir/register/replies/job-xyz"}
```
Your client replies:
```json
{
  "device_id": "custom-display-01",
  "capabilities": {"image_formats": ["png", "jpeg"]},
  "metadata": {"model": "STM32-ePaper"},
  "timestamp": "2025-09-27T12:00:00Z"
}
```
…publishing JSON to the `reply_to` topic. After successful registration you may receive `ready` or `registration_complete` commands.

---
## 11. Content Handling Guidance
| Aspect | Recommendation |
|--------|----------------|
| Caching | Honor `etag` and `ttl_seconds` when provided to avoid redundant downloads |
| Formats | Start with PNG/JPEG; extend to WEBP/GIF if needed |
| Memory | Stream downloads to disk if low RAM (temp files) |
| Validation | Verify `content_type` matches what you can render |
| Security | Enforce size limits & timeout on HTTP fetches |

Pseudo download helper:
```python
async def fetch_image(url: str, session, timeout=15):
    async with session.get(url, timeout=timeout) as resp:
        resp.raise_for_status()
        data = await resp.read()
        if len(data) > 5_000_000:  # 5MB guard
            raise ValueError("Image too large")
        return data
```

---
## 12. Error Handling Strategy
When a failure occurs, emit a structured `error` event *and* continue processing subsequent commands. Suggested `error_type` taxonomy:
- `download_failed`
- `decode_failed`
- `render_failed`
- `invalid_command`
- `unsupported_format`
- `processing`

---
## 13. Scheduling Hints & Polling
If `update_type == "scheduled"` and no new assignment arrives within a tolerance window (e.g. 1.2 × `refresh_interval_s`), you MAY send a diagnostic `presence` update or proactively publish a `refresh` event (if that contract is later extended). Keep logic extensible.

---
## 14. Extending to Other Hardware
| Hardware | Notes |
|----------|-------|
| HDMI / LCD (Linux) | Use Pillow + framebuffer or SDL; rendering identical to e‑ink minus dithering |
| Microcontroller (ESP32) | Implement MQTT over Wi‑Fi (e.g. ESP-IDF), parse JSON, push to display buffer |
| Browser (WebSocket bridge) | Convert MQTT to WebSocket via a gateway; render `<img>` with assignment URL |
| ePaper with partial refresh | Add diff logic: only redraw changed regions if assignments include hints (future) |

---
## 15. Security Considerations
- Enforce allow‑list for brokers or require TLS + username/password
- Validate URLs (scheme http/https only)
- Timebox all network operations
- Zero trust: treat all inbound payload fields as untrusted

---
## 16. Testing Matrix (Suggested)
| Scenario | Expected Result |
|----------|-----------------|
| Valid assign | Image downloaded & rendered; ack + rendered events |
| Duplicate assign | Second ignored or re-rendered (idempotent) |
| Unknown command | `error` event with `unknown_command` |
| Download 404 | `error` event `download_failed` |
| Large image (> limit) | `error` event `download_failed` or `unsupported_format` |
| Lost MQTT connection | Auto-reconnect; presence resumes |

---
## 17. Reference Implementation Files (This Repo)
| File | Purpose |
|------|---------|
| `mimir_display/network/mqtt/commands.py` | Command dispatch & handlers |
| `mimir_display/network/mqtt/schemas.py` | TypedDict schemas for MQTT payloads |
| `mimir_display/__main__.py` | Async entrypoint / diagnostics |
| `display_client.py` | Simpler launcher wrapper |
| `mimir_display/content/` | Download & processing pipeline |
| `mimir_display/utils/` | Helpers, logging, environment |

---
## 18. Roadmap Hooks (Design for Future)
Reserved / emerging fields you should ignore unless documented:
- `sequence` (ordering / dedupe)
- `update_type` variations beyond `push|scheduled`
- Additional delivery types: `inline` (base64), `multipart` (future)
- Scene overlays & composition hints

Design your client to ignore unknown top-level keys gracefully.

---
## 19. Minimal Non-Python Example (Node.js Sketch)
```javascript
import { connect } from 'mqtt'
const displayId = 'custom-node-display'
const cmdTopic = `mimir/${displayId}/cmd`
const evtTopic = `mimir/${displayId}/evt`

const client = connect('mqtt://localhost:1883')
client.on('connect', () => client.subscribe(cmdTopic))

function publish(evt) {
  evt.timestamp = new Date().toISOString()
  client.publish(evtTopic, JSON.stringify(evt), { qos: 1 })
}

client.on('message', (topic, payload) => {
  try {
    const cmd = JSON.parse(payload.toString())
    if (cmd.type === 'assign') {
      publish({ type: 'ack', assignment_id: cmd.assignment_id, ok: true })
      // TODO: download & render image
      publish({ type: 'rendered', assignment_id: cmd.assignment_id, duration_ms: 200 })
    } else {
      publish({ type: 'error', assignment_id: cmd.assignment_id, error_type: 'unknown_command', message: 'Unsupported' })
    }
  } catch (e) {
    publish({ type: 'error', error_type: 'invalid_json', message: String(e) })
  }
})
```

---
## 20. Implementation Checklist
- [ ] Connect to broker (QoS 1) and subscribe to commands
- [ ] Parse and dispatch incoming JSON
- [ ] Implement `assign` & `display_image`
- [ ] Emit `ack` and `rendered` events
- [ ] Error pathway emits structured `error`
- [ ] Handle `set_scene` / `clear_scene` if scenes relevant
- [ ] Respect `update_type` & `refresh_interval_s`
- [ ] Optional: presence heartbeat
- [ ] Optional: registration flow
- [ ] Graceful reconnect on MQTT drop
- [ ] Resource constraints: memory & disk limits for cache

---
## 21. Contributing
If your hardware needs additional delivery types or richer metadata (animations, multi-panel), propose extensions via GitHub issues. Keep backward compatibility: only additive fields, never repurpose semantics.

---
## 22. Summary
This specification provides the stable contract between the Mimir platform and any display implementation. Focus on:
- **Simplicity first** (assign + rendered loop)
- **Resilience** (retries, graceful errors)
- **Extensibility** (ignore what you don't use)  
Follow these guidelines and your custom display—whether ePaper, LCD, LED matrix, Web, or microcontroller—will interoperate seamlessly.

Happy building!
