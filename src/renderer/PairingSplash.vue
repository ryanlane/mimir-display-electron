<template>
  <div class="splash">
    <div class="splash-layout">
      <!-- Left: branding + code -->
      <div class="splash-left">
        <div class="brand">
          <span class="brand-dot"></span>
          <span class="brand-name">mimir</span>
        </div>
        <div class="code-label">Enter this code in Mimir to pair</div>
        <div class="code">{{ info?.pairCode ?? '------' }}</div>
        <div class="meta">
          <span class="meta-row" v-if="info?.ipAddress">
            <span class="meta-key">IP</span>
            <span class="meta-val">{{ info.ipAddress }}</span>
          </span>
          <span class="meta-row" v-if="info?.displayId">
            <span class="meta-key">ID</span>
            <span class="meta-val">{{ info.displayId }}</span>
          </span>
          <span class="meta-row" v-if="info?.apiUrl">
            <span class="meta-key">Server</span>
            <span class="meta-val">{{ info.apiUrl }}</span>
          </span>
        </div>
      </div>

      <!-- Divider -->
      <div class="divider"></div>

      <!-- Right: QR code -->
      <div class="splash-right">
        <img
          v-if="info?.qrDataUrl"
          :src="info.qrDataUrl"
          class="qr"
          alt="Pairing QR Code"
        />
        <div v-else class="qr-placeholder">
          <span>Set MIMIR_API_URL</span>
          <span>to enable QR code</span>
        </div>
        <div class="qr-label">Scan to open Mimir</div>
      </div>
    </div>

    <!-- Status bar -->
    <div class="status-bar" :class="{ 'status-error': statusIsError, 'status-ok': statusIsOk }">
      <span class="status-dot"></span>
      <span>{{ statusText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

interface PairingInfo {
  pairCode: string
  qrDataUrl: string | null
  displayId: string
  apiUrl: string | null
  ipAddress: string
}

const info = ref<PairingInfo | null>(null)
const statusText = ref('Connecting to MQTT broker…')
const statusIsError = ref(false)
const statusIsOk = ref(false)

const bridge = (window as any).mimirDisplay

let unsubStatus: (() => void) | null = null

onMounted(async () => {
  if (!bridge?.getPairingInfo) return
  try {
    info.value = await bridge.getPairingInfo()
  } catch {
    statusText.value = 'Failed to load pairing info'
    statusIsError.value = true
  }

  unsubStatus = bridge.onPairingStatus?.((payload: { status: string; message?: string; isError: boolean }) => {
    statusIsError.value = payload.isError
    statusIsOk.value = payload.status === 'pending'
    if (payload.status === 'pending') {
      statusText.value = payload.message ?? 'Code accepted — enter it in Mimir to complete pairing'
    } else if (payload.status === 'error') {
      statusText.value = payload.message ?? 'Pairing error'
    } else {
      statusText.value = payload.message ?? payload.status
    }
  })
})

onBeforeUnmount(() => {
  unsubStatus?.()
})
</script>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  background: #0b1314;
  color: #d4e8e0;
  display: flex;
  flex-direction: column;
  font-family: system-ui, 'Segoe UI', sans-serif;
  user-select: none;
}

.splash-layout {
  flex: 1;
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

/* Left panel */
.splash-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2rem 2.5rem;
  gap: 1rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #00ff30c0;
  box-shadow: 0 0 8px #00ff30c0;
}

.brand-name {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: lowercase;
  color: #00e0be;
}

.code-label {
  font-size: 0.8rem;
  color: #7a9e93;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.code {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: clamp(2rem, 8vw, 4rem);
  font-weight: 700;
  letter-spacing: 0.25em;
  color: #f0faf6;
  line-height: 1;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.5rem;
}

.meta-row {
  display: flex;
  gap: 0.6rem;
  font-size: 0.75rem;
}

.meta-key {
  color: #4a7a6d;
  width: 3.5rem;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-val {
  color: #9abfb3;
  font-family: 'Courier New', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Divider */
.divider {
  width: 1px;
  background: #1e3330;
  margin: 2rem 0;
}

/* Right panel */
.splash-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1rem;
}

.qr {
  width: min(240px, 60%);
  height: auto;
  border-radius: 8px;
  border: 3px solid #1e3330;
  image-rendering: pixelated;
}

.qr-placeholder {
  width: min(240px, 60%);
  aspect-ratio: 1;
  background: #162325;
  border: 1px dashed #2a4a42;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: #4a7a6d;
}

.qr-label {
  font-size: 0.75rem;
  color: #4a7a6d;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* Status bar */
.status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.5rem;
  background: #0d1e1e;
  border-top: 1px solid #1e3330;
  font-size: 0.75rem;
  color: #5a8a7d;
  transition: background 0.3s, color 0.3s;
  min-height: 2rem;
}

.status-bar.status-ok {
  background: rgba(0, 224, 190, 0.06);
  color: #00e0be;
  border-top-color: rgba(0, 224, 190, 0.15);
}

.status-bar.status-error {
  background: rgba(198, 40, 40, 0.1);
  color: #ef9a9a;
  border-top-color: rgba(198, 40, 40, 0.2);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
</style>
