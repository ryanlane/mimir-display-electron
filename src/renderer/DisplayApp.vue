<template>
  <div id="root" class="root" :class="{ 'has-error': error }">
    <PairingSplash v-if="isPairing" />
    <div v-else-if="!content && !error" class="status">Waiting for assignment…</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <video
      v-else-if="content && content.kind === 'video'"
      ref="videoEl"
      :src="content.url"
      class="display-media"
      :style="computedStyle"
      :loop="content.loop !== false"
      :muted="content.muted !== false"
      autoplay
      playsinline
      @playing="onVideoPlaying"
      @error="onVideoError"
    />
    <img
      v-else-if="content"
      ref="imgEl"
      :src="content.url"
      class="display-media"
      :style="computedStyle"
      @load="onImageLoaded"
      @error="onImageError"
      alt="Display content"
      draggable="false"
    />

    <!-- Info overlay — parity with the Windows client's content info chip -->
    <div v-if="showInfoOverlay && contentInfo" class="info-overlay">
      <div v-for="(line, i) in contentInfo" :key="i">{{ line }}</div>
    </div>

    <AdminPanel
      v-if="showAdmin"
      :content-summary="contentSummary"
      :info-overlay="showInfoOverlay"
      @close="showAdmin = false"
      @toggle-info="showInfoOverlay = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import PairingSplash from './PairingSplash.vue'
import AdminPanel from './AdminPanel.vue'

interface ContentPayload {
  kind: 'image' | 'video'
  url: string
  assignmentId?: string
  loop?: boolean
  muted?: boolean
}

const content = ref<ContentPayload | null>(null)
const error = ref<string | null>(null)
const fitMode = ref<'contain' | 'cover'>('contain')
const videoEl = ref<HTMLVideoElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
const isPairing = ref(false)
const showAdmin = ref(false)
const showInfoOverlay = ref(false)
const mediaDims = ref<[number, number] | null>(null)

const computedStyle = computed(() => ({ objectFit: fitMode.value }))

const contentSummary = computed(() => {
  if (!content.value) return 'No content'
  const dims = mediaDims.value ? ` · ${mediaDims.value[0]}×${mediaDims.value[1]}` : ''
  return `${content.value.kind}${dims}`
})

const contentInfo = computed(() => {
  if (!content.value) return null
  const c = content.value
  const lines = [
    `${c.kind.toUpperCase()}  ${mediaDims.value ? mediaDims.value.join('×') : ''}`,
    c.url.length > 80 ? '…' + c.url.slice(-80) : c.url
  ]
  if (c.assignmentId) lines.push(`assignment ${c.assignmentId}`)
  if (c.kind === 'video') lines.push(`loop=${c.loop !== false} muted=${c.muted !== false}`)
  return lines
})

const bridge = (window as any).mimirDisplay

function report(kind: string, url: string, ok: boolean, detail?: string) {
  try { bridge?.contentReady?.({ kind, url, ok, detail }) } catch { /* bridge optional */ }
}

function onImageLoaded() {
  if (imgEl.value) mediaDims.value = [imgEl.value.naturalWidth, imgEl.value.naturalHeight]
  if (content.value) report('image', content.value.url, true)
}
function onImageError() {
  error.value = 'Failed to load image'
  if (content.value) report('image', content.value.url, false, 'image load error')
}
function onVideoPlaying() {
  if (videoEl.value) mediaDims.value = [videoEl.value.videoWidth, videoEl.value.videoHeight]
  if (content.value) report('video', content.value.url, true)
}
function onVideoError() {
  const mediaError = videoEl.value?.error
  error.value = `Failed to play video${mediaError ? ` (code ${mediaError.code})` : ''}`
  if (content.value) report('video', content.value.url, false, error.value)
}

// Keyboard parity with the Windows client: F11 fullscreen, Escape exits
// (or closes the panel when open). F10 / M opens the admin panel; a
// long-press (2s) anywhere does the same for touch-only devices.
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'F11') {
    e.preventDefault()
    bridge?.admin?.toggleFullscreen?.()
  } else if (e.key === 'F10' || (e.key.toLowerCase() === 'm' && !showAdmin.value)) {
    e.preventDefault()
    showAdmin.value = !showAdmin.value
  } else if (e.key === 'Escape') {
    if (showAdmin.value) showAdmin.value = false
    else bridge?.admin?.quit?.()
  } else if (e.key.toLowerCase() === 'i' && !showAdmin.value) {
    showInfoOverlay.value = !showInfoOverlay.value
  }
}

let pressTimer: ReturnType<typeof setTimeout> | null = null
function onPointerDown() {
  pressTimer = setTimeout(() => { showAdmin.value = true }, 2000)
}
function onPointerUp() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
}

let unsubscribeContent: (() => void) | null = null
let unsubscribeError: (() => void) | null = null
let unsubscribePaired: (() => void) | null = null

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  if (!bridge?.onSetContent) {
    error.value = 'Display bridge unavailable (preload not loaded)'
    return
  }

  // Check if we're in pairing mode — non-null response means unregistered
  const pairingInfo = await bridge.getPairingInfo?.()
  if (pairingInfo) {
    isPairing.value = true
    unsubscribePaired = bridge.onPaired?.(() => {
      isPairing.value = false
    })
    return
  }

  unsubscribeContent = bridge.onSetContent((payload: ContentPayload) => {
    error.value = null
    mediaDims.value = null
    // Replacing content tears down the previous element (video unloads and
    // stops its network activity when the <video> node is removed).
    content.value = payload
  })
  unsubscribeError = bridge.onError((payload: { message: string }) => {
    error.value = payload.message
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  unsubscribeContent?.()
  unsubscribeError?.()
  unsubscribePaired?.()
})
</script>

<style scoped>
.root { position: fixed; inset: 0; background: #000; color: #ccc; display: flex; align-items: center; justify-content: center; user-select: none; font-family: system-ui, sans-serif; }
.display-media { width: 100%; height: 100%; object-fit: contain; transition: opacity 0.25s ease-in-out; }
.status { font-size: 1.4rem; opacity: 0.85; }
.status.error { color: #ff6666; }
.info-overlay {
  position: fixed; left: 12px; bottom: 12px; z-index: 40;
  background: rgba(0, 0, 0, 0.72); border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px; padding: 8px 12px;
  font: 11.5px/1.6 ui-monospace, monospace; color: #b9c4cf;
  max-width: 60vw; word-break: break-all;
}
</style>
