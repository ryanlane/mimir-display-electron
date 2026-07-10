'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const mqtt = require('mqtt')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
let safeParseCommand
// Candidate ESM module paths (dev + prod). We'll dynamic import because TS outputs ESM under type:module.
const candidates = [
  path.join(__dirname, '../../shared/types/mqttSchemas.js'),
  path.join(__dirname, '../../../dist/shared/types/mqttSchemas.js')
]

async function loadSchemas() {
  for (const c of candidates) {
    try {
      const mod = await import(pathToFileURL(c).href)
      if (mod && mod.safeParseCommand) {
        safeParseCommand = mod.safeParseCommand
        return
      }
    } catch (_) { /* try next */ }
  }
  console.error('[worker] schema load failed tried:', candidates)
  throw new Error('Unable to resolve shared mqttSchemas.js from candidates: ' + candidates.join(', '))
}

/**
 * workerData: { brokerUrl, displayId, logLevel, mqttUsername?, mqttPassword?, pairCode?, apiUrl?, displayName? }
 */

let client
let stopped = false
const seenAssignments = new Map() // key: assignment_id, value: sequence (or true)
const startTs = Date.now()
// Chromium <img> decodes and animates webp/gif natively. <video>: stock
// Electron ships WITHOUT proprietary codecs — H.264/AAC mp4 will NOT play
// (MediaError code 4). Royalty-free VP8/VP9/AV1 in WebM work fully, so
// sources must deliver webm to this client.
const capabilities = {
  image_formats: ['png', 'jpg', 'webp', 'gif'],
  supports_animation: true,
  supports_video: true,
  video_formats: ['webm']
}
let pendingRegister = null // { reply_to }

// Pairing state — cleared after finalize_registration is received
let isPairing = Boolean(workerData.pairCode)
let pairRepublishTimer = null

function log(level, message) { parentPort.postMessage({ type: 'log', level, message }) }

// MQTT monitor feed — mirrors the native Windows client's MessageReceived
// event: direction + topic + a payload snippet for the admin panel.
function traffic(direction, topic, payload) {
  try {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    parentPort.postMessage({
      type: 'mqtt_traffic',
      direction, // 'sent' | 'received'
      topic,
      snippet: text.length > 400 ? text.slice(0, 400) + '…' : text,
      ts: Date.now()
    })
  } catch { /* monitoring must never break messaging */ }
}

function publishPairRequest() {
  const { displayId, pairCode, displayName, regToken } = workerData
  const msg = {
    device_id: displayId,
    code: pairCode,
    ...(regToken ? { reg_token: regToken } : {}),
    capabilities,
    metadata: {
      runtime: 'electron',
      version: '0.1.0',
      ...(displayName ? { name: displayName } : {})
    },
    reply_to: `mimir/${displayId}/pair/ack`
  }
  try {
    const body = JSON.stringify(msg)
    client.publish('mimir/registry/pair', body, { qos: 1 })
    traffic('sent', 'mimir/registry/pair', body)
    log('info', `pair_request_published code=${pairCode}`)
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: 'pair_publish_fail: ' + e.message })
  }
}

function connect() {
  const { brokerUrl, displayId, mqttUsername, mqttPassword } = workerData
  // Credentials for brokers with auth enabled (prod mosquitto). Absent for
  // open brokers (dev).
  const opts = {}
  if (mqttUsername) { opts.username = mqttUsername; opts.password = mqttPassword || '' }
  client = mqtt.connect(brokerUrl, opts)

  client.on('connect', () => {
    log('info', 'MQTT connected')
    parentPort.postMessage({ type: 'worker_up' })
    parentPort.postMessage({ type: 'mqtt_state', connected: true })
    client.subscribe(`mimir/${displayId}/cmd`, { qos: 1 })

    if (isPairing) {
      // Subscribe to pair ack topic and announce our code
      client.subscribe(`mimir/${displayId}/pair/ack`, { qos: 1 })
      publishPairRequest()
      // Re-announce every 5 minutes in case the server restarts
      pairRepublishTimer = setInterval(() => {
        if (!stopped && isPairing) publishPairRequest()
      }, 5 * 60 * 1000)
      pairRepublishTimer.unref()
    }

    publishStatus(displayId)
    setInterval(() => { if (!stopped) sendPresence(displayId) }, 60000).unref()
  })

  client.on('message', (topic, payload) => {
    const { displayId } = workerData
    traffic('received', topic, payload.toString())

    // Handle pair ack on the dedicated ack topic
    if (isPairing && topic === `mimir/${displayId}/pair/ack`) {
      handlePairAck(payload)
      return
    }

    let parsed
    try { parsed = JSON.parse(payload.toString()) } catch (e) { return parentPort.postMessage({ type: 'error', error: 'invalid_json: ' + e.message }) }
    const result = safeParseCommand(parsed)
    if (!result.ok) return parentPort.postMessage({ type: 'error', error: 'invalid_command: ' + result.error })
    const cmd = result.value
    handleValidatedCommand(cmd)
  })

  client.on('error', (err) => log('error', 'mqtt_error ' + err.message))
  client.on('close', () => { log('warn', 'mqtt_disconnected'); parentPort.postMessage({ type: 'mqtt_state', connected: false }); if (!stopped) setTimeout(connect, 3000).unref() })
}

function handlePairAck(payload) {
  let data
  try { data = JSON.parse(payload.toString()) } catch { return }
  log('info', `pair_ack status=${data.status} message=${data.message || ''}`)
  parentPort.postMessage({ type: 'pairing_ack', status: data.status, message: data.message })
}

function publishEventTopic(topic, evt) {
  try { evt.timestamp = new Date().toISOString(); const body = JSON.stringify(evt); client.publish(topic, body, { qos: 1 }); traffic('sent', topic, body) }
  catch (e) { parentPort.postMessage({ type: 'error', error: 'publish_fail: ' + e.message }) }
}

function publishEvent(displayId, evt) {
  publishEventTopic(`mimir/${displayId}/evt`, evt)
}

function sendPresence(displayId) {
  publishEvent(displayId, {
    type: 'presence',
    device_id: displayId,
    uptime_s: Math.floor((Date.now() - startTs) / 1000),
    capabilities,
    status: { online: true }
  })
}

function handleValidatedCommand(cmd) {
  const t = cmd.type
  const assignmentId = cmd.assignment_id
  // Idempotency
  if (assignmentId) {
    const prior = seenAssignments.get(assignmentId)
    const seq = cmd.sequence ?? null
    if (seq != null) {
      if (prior != null && prior >= seq) return log('debug', `dedupe ${assignmentId} seq ${seq}`)
      seenAssignments.set(assignmentId, seq)
    } else if (prior === true) return log('debug', `dedupe ${assignmentId}`)
    else seenAssignments.set(assignmentId, true)
  }
  switch (t) {
    case 'assign':
      parentPort.postMessage({ type: 'render_request', assignmentId, delivery: normalizeDelivery(cmd), raw: cmd })
      publishEvent(workerData.displayId, { type: 'ack', assignment_id: assignmentId, ok: true })
      break
    case 'display_image':
      parentPort.postMessage({ type: 'render_request', assignmentId, delivery: { url: cmd.image_url }, raw: cmd })
      publishEvent(workerData.displayId, { type: 'ack', assignment_id: assignmentId, ok: true })
      break
    case 'refresh':
      publishEvent(workerData.displayId, { type: 'ack', assignment_id: assignmentId, ok: true, message: 'refresh_noop' })
      break
    case 'register':
      pendingRegister = { reply_to: cmd.reply_to }
      // Immediately respond with capabilities
      publishEventTopic(cmd.reply_to, {
        device_id: workerData.displayId,
        capabilities,
        metadata: { runtime: 'electron', version: '0.1.0' }
      })
      publishEvent(workerData.displayId, { type: 'ack', assignment_id: assignmentId, ok: true, message: 'register_replied' })
      break
    case 'finalize_registration':
      // Pairing complete — stop re-announcing and notify main thread
      isPairing = false
      if (pairRepublishTimer) { clearInterval(pairRepublishTimer); pairRepublishTimer = null }
      parentPort.postMessage({
        type: 'pairing_complete',
        displayId: cmd.display_id,
        registrationKey: cmd.registration_key,
        displayName: cmd.display_name,
        displayLocation: cmd.display_location
      })
      publishEvent(workerData.displayId, { type: 'ack', assignment_id: assignmentId, ok: true, message: 'finalize_registration_ack' })
      break
    case 'set_scene':
    case 'clear_scene':
    case 'ready':
    case 'registration_complete':
      publishEvent(workerData.displayId, { type: 'ack', assignment_id: assignmentId, ok: true })
      break
    default:
      publishEvent(workerData.displayId, { type: 'error', assignment_id: assignmentId, error_type: 'unknown_command', message: 'Unsupported' })
  }
}

function normalizeDelivery(cmd) {
  const d = cmd?.content?.delivery
  if (!d) return { url: '' }
  return {
    url: d.url, contentType: d.content_type, etag: d.etag, ttlSeconds: d.ttl_seconds,
    loop: d.loop, muted: d.muted
  }
}

function publishStatus(displayId) {
  // Retained status mirrors the Pi client convention — the server's
  // presence service reads capabilities (resolution etc.) from here and
  // syncs them to the display's DB record.
  try {
    const body = JSON.stringify({
      status: 'online',
      device_id: displayId,
      capabilities,
      timestamp: new Date().toISOString()
    })
    client.publish(`mimir/${displayId}/status`, body, { qos: 1, retain: true })
    traffic('sent', `mimir/${displayId}/status`, body)
  } catch (e) { parentPort.postMessage({ type: 'error', error: 'status_publish_fail: ' + e.message }) }
}

parentPort.on('message', (msg) => {
  const { displayId } = workerData
  switch (msg.type) {
    case 'ack': publishEvent(displayId, { type: 'ack', assignment_id: msg.assignmentId, ok: msg.ok, message: msg.message }); break
    case 'rendered': publishEvent(displayId, { type: 'rendered', assignment_id: msg.assignmentId, duration_ms: msg.durationMs }); break
    case 'error': publishEvent(displayId, { type: 'error', assignment_id: msg.assignmentId, error_type: msg.errorType, message: msg.message }); break
    case 'presence': publishEvent(displayId, { type: 'presence', ...msg.payload }); break
    case 'update_capabilities':
      // Dynamic capability update (e.g. window resized) — merge and
      // immediately re-announce so the server renders at the new size.
      Object.assign(capabilities, msg.capabilities || {})
      if (client && client.connected) {
        publishStatus(displayId)
        sendPresence(displayId)
      }
      break
    case 'shutdown': stopped = true; try { client.end(true) } catch {}; break
  }
})

loadSchemas().then(() => {
  connect()
}).catch(err => {
  parentPort.postMessage({ type: 'error', error: 'schema_load_failed ' + err.message })
})
