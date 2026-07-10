<template>
  <div class="admin-backdrop" @click.self="$emit('close')">
    <div class="admin-panel">
      <header class="panel-header">
        <div class="head-left">
          <span class="conn-dot" :class="{ online: status?.connected }" />
          <div>
            <div class="device-id">{{ status?.displayName || status?.deviceId || '…' }}</div>
            <div class="sub">{{ status?.deviceId }} · v{{ status?.version }} · {{ status?.connected ? 'Connected' : 'Disconnected' }}</div>
          </div>
        </div>
        <button class="icon-btn" title="Close (Esc)" @click="$emit('close')">✕</button>
      </header>

      <nav class="tabs">
        <button v-for="t in tabs" :key="t" class="tab" :class="{ active: tab === t }" @click="tab = t">{{ t }}</button>
      </nav>

      <!-- STATUS -->
      <section v-if="tab === 'Status'" class="body">
        <div class="rows">
          <div class="row"><span>Device ID</span><code>{{ status?.deviceId }}</code></div>
          <div class="row"><span>MQTT broker</span><code>{{ status?.brokerUrl }}{{ status?.mqttUsername ? ` (as ${status.mqttUsername})` : '' }}</code></div>
          <div class="row"><span>API</span><code>{{ status?.apiUrl || '—' }}</code></div>
          <div class="row"><span>Registered</span><span>{{ status?.registered ? 'Yes' : 'No (pairing)' }}</span></div>
          <div class="row" v-if="status?.pairCode"><span>Pair code</span><code class="pair">{{ status.pairCode }}</code></div>
          <div class="row"><span>Window</span><span>{{ status?.resolution ? status.resolution.join('×') : '—' }}{{ status?.fullscreen ? ' · fullscreen' : '' }}</span></div>
          <div class="row"><span>Content</span><span>{{ contentSummary }}</span></div>
        </div>
        <div class="btn-row">
          <button class="btn" @click="onToggleFullscreen">{{ status?.fullscreen ? 'Exit Fullscreen' : 'Fullscreen' }} <kbd>F11</kbd></button>
          <button class="btn" @click="toggleInfo">{{ infoOverlay ? 'Hide' : 'Show' }} Info Overlay</button>
        </div>
      </section>

      <!-- MQTT MONITOR -->
      <section v-else-if="tab === 'MQTT'" class="body monitor">
        <div class="monitor-list" ref="monitorEl">
          <div v-if="traffic.length === 0" class="empty">No messages yet</div>
          <div v-for="(m, i) in traffic" :key="i" class="msg" :class="m.direction">
            <span class="dir">{{ m.direction === 'sent' ? '↑' : '↓' }}</span>
            <span class="time">{{ fmtTime(m.ts) }}</span>
            <span class="topic">{{ m.topic }}</span>
            <span class="snippet">{{ m.snippet }}</span>
          </div>
        </div>
      </section>

      <!-- SETTINGS -->
      <section v-else-if="tab === 'Settings'" class="body">
        <p class="hint">Saved settings apply as defaults — explicit environment variables always win.
          Saving restarts the display.</p>
        <label class="field"><span>Display name</span>
          <input v-model="form.displayName" placeholder="e.g. Kitchen Display" /></label>
        <label class="field"><span>Display ID</span>
          <input v-model="form.displayId" placeholder="electron-display-01" /></label>
        <label class="field"><span>MQTT URL</span>
          <input v-model="form.mqttUrl" placeholder="mqtt://mimir.local:1883" /></label>
        <div class="field-pair">
          <label class="field"><span>MQTT username</span>
            <input v-model="form.mqttUsername" placeholder="(none — open broker)" autocomplete="off" /></label>
          <label class="field"><span>MQTT password</span>
            <input v-model="form.mqttPassword" type="password" placeholder="••••••••" autocomplete="new-password" /></label>
        </div>
        <label class="field"><span>API URL</span>
          <input v-model="form.apiUrl" placeholder="http://mimir.local:5000" /></label>
        <label class="check"><input type="checkbox" v-model="form.startFullscreen" /> Start in fullscreen</label>
        <div class="btn-row">
          <button class="btn primary" @click="saveSettings">Save &amp; Restart</button>
        </div>
      </section>

      <!-- MAINTENANCE -->
      <section v-else class="body">
        <div class="action-list">
          <div class="action">
            <div><strong>Clear content cache</strong><div class="sub">Remove downloaded images; content re-fetches on next update</div></div>
            <button class="btn" @click="clearCache">{{ clearedMsg || 'Clear' }}</button>
          </div>
          <div class="action">
            <div><strong>Open logs folder</strong><div class="sub">{{ status?.logDir }}</div></div>
            <button class="btn" @click="openLogs">Open</button>
          </div>
          <div class="action">
            <div><strong>Reset pairing</strong><div class="sub">Clears device identity — the display restarts and shows a new pair code</div></div>
            <button class="btn danger" @click="confirmReset ? doReset() : (confirmReset = true)">
              {{ confirmReset ? 'Really reset?' : 'Reset' }}
            </button>
          </div>
          <div class="action">
            <div><strong>Exit display</strong><div class="sub">Close the application</div></div>
            <button class="btn danger" @click="confirmQuit ? doQuit() : (confirmQuit = true)">
              {{ confirmQuit ? 'Really exit?' : 'Exit' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const props = defineProps<{ contentSummary: string; infoOverlay: boolean }>()
const emit = defineEmits(['close', 'toggle-info'])

const tabs = ['Status', 'MQTT', 'Settings', 'Maintenance']
const tab = ref('Status')
const status = ref<any>(null)
const traffic = ref<any[]>([])
const form = ref<any>({ displayName: '', displayId: '', mqttUrl: '', mqttUsername: '', mqttPassword: '', apiUrl: '', startFullscreen: false })
const clearedMsg = ref('')
const confirmReset = ref(false)
const confirmQuit = ref(false)
const monitorEl = ref<HTMLElement | null>(null)
const infoOverlay = ref(props.infoOverlay)

const admin = (window as any).mimirDisplay?.admin

let unsubTraffic: (() => void) | null = null
let unsubState: (() => void) | null = null

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false })
}

async function refreshStatus() {
  try { status.value = await admin?.getStatus() } catch { /* ignore */ }
}

async function onToggleFullscreen() {
  await admin?.toggleFullscreen()
  refreshStatus()
}

function toggleInfo() {
  infoOverlay.value = !infoOverlay.value
  emit('toggle-info', infoOverlay.value)
}

async function clearCache() {
  const res = await admin?.clearCache()
  clearedMsg.value = `Cleared ${res?.cleared ?? 0}`
  setTimeout(() => { clearedMsg.value = '' }, 2500)
}

function openLogs() { admin?.openLogs() }
function doReset() { admin?.resetPairing() }
function doQuit() { admin?.quit() }

async function saveSettings() {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(form.value)) {
    if (typeof v === 'string' ? v.trim() : v) clean[k] = typeof v === 'string' ? v.trim() : v
  }
  await admin?.saveSettings(clean)
}

watch(traffic, async () => {
  await nextTick()
  if (monitorEl.value) monitorEl.value.scrollTop = monitorEl.value.scrollHeight
}, { deep: true })

onMounted(async () => {
  refreshStatus()
  try { traffic.value = (await admin?.getTraffic()) || [] } catch { /* ignore */ }
  try {
    const saved = await admin?.getSettings()
    form.value = { displayName: '', displayId: '', mqttUrl: '', mqttUsername: '', mqttPassword: '', apiUrl: '', startFullscreen: false, ...(saved || {}) }
  } catch { /* ignore */ }
  unsubTraffic = admin?.onTraffic?.((entry: any) => {
    traffic.value.push(entry)
    if (traffic.value.length > 300) traffic.value.shift()
  })
  unsubState = admin?.onMqttState?.(() => refreshStatus())
})

onBeforeUnmount(() => {
  unsubTraffic?.()
  unsubState?.()
})
</script>

<style scoped>
.admin-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
}
.admin-panel {
  width: min(640px, 92vw); max-height: 86vh;
  display: flex; flex-direction: column;
  background: rgba(18, 22, 28, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
  color: #dfe6ee; font-size: 14px;
  overflow: hidden;
}
.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.head-left { display: flex; align-items: center; gap: 12px; }
.conn-dot { width: 10px; height: 10px; border-radius: 50%; background: #e05252; flex-shrink: 0; }
.conn-dot.online { background: #37cf6e; box-shadow: 0 0 8px rgba(55, 207, 110, 0.6); }
.device-id { font-weight: 600; }
.sub { font-size: 12px; color: #8b96a3; }
.icon-btn { background: none; border: none; color: #8b96a3; font-size: 16px; cursor: pointer; padding: 4px 8px; }
.icon-btn:hover { color: #fff; }

.tabs { display: flex; gap: 2px; padding: 8px 12px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
.tab {
  background: none; border: none; color: #8b96a3; padding: 8px 14px; cursor: pointer;
  font-size: 13px; font-weight: 600; border-bottom: 2px solid transparent;
}
.tab.active { color: #fff; border-bottom-color: #37cf6e; }

.body { padding: 16px 18px; overflow-y: auto; }
.rows { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.row > span:first-child { color: #8b96a3; }
.row code { font-size: 12.5px; color: #cfe3d4; word-break: break-all; text-align: right; }
code.pair { font-size: 18px; letter-spacing: 3px; color: #37cf6e; font-weight: 700; }

.btn-row { display: flex; gap: 10px; margin-top: 16px; }
.btn {
  background: rgba(255, 255, 255, 0.07); color: #dfe6ee;
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px;
  padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 600;
}
.btn:hover { background: rgba(255, 255, 255, 0.13); }
.btn.primary { background: #1f7a3d; border-color: #2b9e52; }
.btn.primary:hover { background: #259149; }
.btn.danger { background: rgba(224, 82, 82, 0.14); border-color: rgba(224, 82, 82, 0.4); color: #f0a0a0; }
.btn.danger:hover { background: rgba(224, 82, 82, 0.28); }
kbd { font-size: 10px; background: rgba(255,255,255,0.1); border-radius: 3px; padding: 1px 5px; margin-left: 6px; }

.monitor { padding: 0; }
.monitor-list { height: 46vh; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 11.5px; padding: 10px 14px; }
.empty { color: #66707c; text-align: center; padding: 40px 0; }
.msg { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); align-items: baseline; }
.msg .dir { flex-shrink: 0; width: 12px; }
.msg.sent .dir { color: #5aa9ff; }
.msg.received .dir { color: #37cf6e; }
.msg .time { color: #66707c; flex-shrink: 0; }
.msg .topic { color: #cdb7ff; flex-shrink: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg .snippet { color: #97a3b0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.hint { font-size: 12.5px; color: #8b96a3; margin: 0 0 14px; }
.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.field span { font-size: 12px; font-weight: 600; color: #8b96a3; }
.field input {
  background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px; color: #eef2f6; padding: 8px 11px; font-size: 13.5px;
}
.field input:focus { outline: none; border-color: #37cf6e; }
.check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; margin: 4px 0 8px; }
.field-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.action-list { display: flex; flex-direction: column; gap: 14px; }
.action { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.action .sub { margin-top: 2px; }
</style>
