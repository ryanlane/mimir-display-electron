<template>
  <div id="root" class="root" :class="{ 'has-error': error }">
    <div v-if="!content && !error" class="status">Waiting for assignment…</div>
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
      :src="content.url"
      class="display-media"
      :style="computedStyle"
      @load="onImageLoaded"
      @error="onImageError"
      alt="Display content"
      draggable="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

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

const computedStyle = computed(() => ({ objectFit: fitMode.value }))

const bridge = (window as any).mimirDisplay

function report(kind: string, url: string, ok: boolean, detail?: string) {
  try { bridge?.contentReady?.({ kind, url, ok, detail }) } catch { /* bridge optional */ }
}

function onImageLoaded() {
  if (content.value) report('image', content.value.url, true)
}
function onImageError() {
  error.value = 'Failed to load image'
  if (content.value) report('image', content.value.url, false, 'image load error')
}
function onVideoPlaying() {
  if (content.value) report('video', content.value.url, true)
}
function onVideoError() {
  const mediaError = videoEl.value?.error
  error.value = `Failed to play video${mediaError ? ` (code ${mediaError.code})` : ''}`
  if (content.value) report('video', content.value.url, false, error.value)
}

let unsubscribeContent: (() => void) | null = null
let unsubscribeError: (() => void) | null = null

onMounted(() => {
  if (!bridge?.onSetContent) {
    error.value = 'Display bridge unavailable (preload not loaded)'
    return
  }
  unsubscribeContent = bridge.onSetContent((payload: ContentPayload) => {
    error.value = null
    // Replacing content tears down the previous element (video unloads and
    // stops its network activity when the <video> node is removed).
    content.value = payload
  })
  unsubscribeError = bridge.onError((payload: { message: string }) => {
    error.value = payload.message
  })
})

onBeforeUnmount(() => {
  unsubscribeContent?.()
  unsubscribeError?.()
})
</script>

<style scoped>
.root { position: fixed; inset: 0; background: #000; color: #ccc; display: flex; align-items: center; justify-content: center; user-select: none; font-family: system-ui, sans-serif; }
.display-media { width: 100%; height: 100%; object-fit: contain; transition: opacity 0.25s ease-in-out; }
.status { font-size: 1.4rem; opacity: 0.85; }
.status.error { color: #ff6666; }
</style>
