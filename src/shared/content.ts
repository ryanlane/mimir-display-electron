// Content-kind detection shared by the main process and tests.

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv'])

export type ContentKind = 'image' | 'video'

/**
 * Decide whether a delivery is video. The content_type from the assignment
 * is authoritative; the URL extension is the fallback for servers that
 * don't set one.
 */
export function detectContentKind(contentType?: string | null, url?: string | null): ContentKind {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim()
  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('image/')) return 'image'
  if (url) {
    try {
      const pathname = new URL(url, 'http://x').pathname
      const ext = pathname.split('.').pop()?.toLowerCase() || ''
      if (VIDEO_EXTENSIONS.has(ext)) return 'video'
    } catch {
      /* fall through to image */
    }
  }
  return 'image'
}
