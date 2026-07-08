import { describe, it, expect } from 'vitest'
import { detectContentKind } from './content.js'
import { AssignCommandSchema } from './types/mqttSchemas.js'

describe('detectContentKind', () => {
  it('trusts video content types', () => {
    expect(detectContentKind('video/mp4', 'http://x/file')).toBe('video')
    expect(detectContentKind('video/webm; codecs=vp9', 'http://x/file')).toBe('video')
  })

  it('trusts image content types even with video-ish URLs', () => {
    expect(detectContentKind('image/png', 'http://x/poster.mp4.png')).toBe('image')
    expect(detectContentKind('image/webp', 'http://x/loop.webp')).toBe('image')
  })

  it('falls back to URL extension when content type is missing', () => {
    expect(detectContentKind(undefined, 'http://x/movie.mp4')).toBe('video')
    expect(detectContentKind('', 'http://x/clip.webm?v=2')).toBe('video')
    expect(detectContentKind(null, 'http://x/photo.jpg')).toBe('image')
  })

  it('defaults to image when nothing is known', () => {
    expect(detectContentKind(undefined, undefined)).toBe('image')
    expect(detectContentKind('application/octet-stream', 'http://x/blob')).toBe('image')
  })
})

describe('AssignCommandSchema video fields', () => {
  it('passes loop/muted playback hints through', () => {
    const parsed = AssignCommandSchema.parse({
      type: 'assign',
      assignment_id: 'a1',
      content: {
        delivery: {
          url: 'http://server:5000/api/channels/x/stream/clip.mp4',
          content_type: 'video/mp4',
          loop: false,
          muted: true
        }
      }
    })
    expect(parsed.content.delivery.loop).toBe(false)
    expect(parsed.content.delivery.muted).toBe(true)
  })

  it('leaves playback hints undefined when absent (defaults applied downstream)', () => {
    const parsed = AssignCommandSchema.parse({
      type: 'assign',
      assignment_id: 'a2',
      content: { delivery: { url: 'http://server:5000/img.png' } }
    })
    expect(parsed.content.delivery.loop).toBeUndefined()
    expect(parsed.content.delivery.muted).toBeUndefined()
  })
})
