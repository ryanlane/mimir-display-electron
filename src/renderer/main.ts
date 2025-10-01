import { createApp } from 'vue'
import DisplayApp from './DisplayApp.vue'

const app = createApp(DisplayApp)

// Basic global event bus substitute; will refactor to composable/store later
// @ts-expect-error preload injection placeholder
window.__DISPLAY_STATE__ = { currentImage: '' }

app.mount('#app')
