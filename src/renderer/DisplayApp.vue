<template>
  <div id="root" class="root" :class="{ 'has-error': error }">
    <div v-if="!loaded && !error" class="status">Waiting for assignment…</div>
    <div v-else-if="error" class="status error">{{ error }}</div>
    <img
      v-else
      :src="imageSrc"
      class="display-image"
      :style="computedStyle"
      @load="onImageLoaded"
      @error="onImageError"
      alt="Display content"
      draggable="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const imageSrc = ref<string>('')
const loaded = ref(false)
const error = ref<string | null>(null)
const fitMode = ref<'contain' | 'cover'>('contain')

const computedStyle = computed(() => ({ objectFit: fitMode.value }))

function onImageLoaded() { loaded.value = true }
function onImageError(e: Event) { error.value = 'Failed to load image'; console.warn('Image error', e) }

onMounted(() => {
  // IPC listeners (safest via preload; placeholder direct usage until bridge is added)
  // @ts-ignore
  const { ipcRenderer } = window.require ? window.require('electron') : {}
  if (ipcRenderer) {
    ipcRenderer.on('display:setImage', (_: any, payload: { url: string }) => {
      loaded.value = false
      error.value = null
      imageSrc.value = payload.url
    })
    ipcRenderer.on('display:error', (_: any, payload: { message: string }) => {
      error.value = payload.message
    })
  }
  if (!imageSrc.value) {
    imageSrc.value = 'https://via.placeholder.com/800x480.png?text=Mimir+Display'
  }
})
</script>

<style scoped>
.root { position: fixed; inset: 0; background: #000; color: #ccc; display: flex; align-items: center; justify-content: center; user-select: none; font-family: system-ui, sans-serif; }
.display-image { width: 100%; height: 100%; object-fit: contain; image-rendering: auto; transition: opacity 0.25s ease-in-out; }
.status { font-size: 1.4rem; opacity: 0.85; }
.status.error { color: #ff6666; }
</style>
