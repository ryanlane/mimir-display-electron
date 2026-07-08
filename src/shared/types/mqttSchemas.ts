import { z } from 'zod'

// Base fields
const assignmentId = z.string().min(1).describe('Unique assignment id')
const timestamp = z.string().datetime().optional()
const sequence = z.number().int().nonnegative().optional()

// Command Schemas (Service -> Display)
export const AssignCommandSchema = z.object({
  type: z.literal('assign'),
  assignment_id: assignmentId,
  sequence,
  scene_id: z.string().optional(),
  scene_name: z.string().optional(),
  display: z.object({ id: z.string() }).optional(),
  content: z.object({
    delivery: z.object({
      type: z.string().default('url'),
      url: z.string().url(),
      content_type: z.string().optional(),
      etag: z.string().optional(),
      ttl_seconds: z.number().int().positive().optional(),
      // Video playback hints (ignored for images). Defaults: loop, muted.
      loop: z.boolean().optional(),
      muted: z.boolean().optional()
    }),
    metadata: z.record(z.any()).optional()
  }),
  update_type: z.enum(['push', 'scheduled']).optional(),
  refresh_interval_s: z.number().int().positive().optional(),
  timestamp
})

export const DisplayImageCommandSchema = z.object({
  type: z.literal('display_image'),
  assignment_id: assignmentId,
  image_url: z.string().url(),
  timestamp
})

export const RefreshCommandSchema = z.object({
  type: z.literal('refresh'),
  assignment_id: assignmentId,
  timestamp
})

export const SetSceneCommandSchema = z.object({
  type: z.literal('set_scene'),
  assignment_id: assignmentId,
  scene_id: z.string(),
  timestamp
})

export const ClearSceneCommandSchema = z.object({
  type: z.literal('clear_scene'),
  assignment_id: assignmentId,
  timestamp
})

export const RegisterCommandSchema = z.object({
  type: z.literal('register'),
  reply_to: z.string().min(1),
  timestamp
})

export const ReadyCommandSchema = z.object({
  type: z.union([z.literal('ready'), z.literal('registration_complete')]),
  assignment_id: assignmentId.optional(),
  timestamp
})

export const AnyCommandSchema = z.union([
  AssignCommandSchema,
  DisplayImageCommandSchema,
  RefreshCommandSchema,
  SetSceneCommandSchema,
  ClearSceneCommandSchema,
  RegisterCommandSchema,
  ReadyCommandSchema
])

export type AssignCommand = z.infer<typeof AssignCommandSchema>
export type DisplayImageCommand = z.infer<typeof DisplayImageCommandSchema>
export type RefreshCommand = z.infer<typeof RefreshCommandSchema>
export type SetSceneCommand = z.infer<typeof SetSceneCommandSchema>
export type ClearSceneCommand = z.infer<typeof ClearSceneCommandSchema>
export type RegisterCommand = z.infer<typeof RegisterCommandSchema>
export type ReadyCommand = z.infer<typeof ReadyCommandSchema>
export type AnyCommand = z.infer<typeof AnyCommandSchema>

// Event Schemas (Display -> Service)
export const AckEventSchema = z.object({
  type: z.literal('ack'),
  assignment_id: assignmentId.optional(),
  ok: z.boolean().optional(),
  message: z.string().optional(),
  timestamp
})

export const RenderedEventSchema = z.object({
  type: z.literal('rendered'),
  assignment_id: assignmentId,
  duration_ms: z.number().int().nonnegative().optional(),
  timestamp
})

export const ErrorEventSchema = z.object({
  type: z.literal('error'),
  assignment_id: assignmentId.optional(),
  error_type: z.string(),
  message: z.string().optional(),
  timestamp
})

export const PresenceEventSchema = z.object({
  type: z.literal('presence'),
  device_id: z.string().optional(),
  scene_id: z.string().optional(),
  uptime_s: z.number().int().nonnegative().optional(),
  last_assignment_id: z.string().optional(),
  capabilities: z.record(z.any()).optional(),
  status: z.record(z.any()).optional(),
  timestamp
})

export const AnyEventSchema = z.union([
  AckEventSchema,
  RenderedEventSchema,
  ErrorEventSchema,
  PresenceEventSchema
])

export type AckEvent = z.infer<typeof AckEventSchema>
export type RenderedEvent = z.infer<typeof RenderedEventSchema>
export type ErrorEvent = z.infer<typeof ErrorEventSchema>
export type PresenceEvent = z.infer<typeof PresenceEventSchema>
export type AnyEvent = z.infer<typeof AnyEventSchema>

// Helper result type for validation inside worker/main
export function safeParseCommand(obj: unknown): { ok: true; value: AnyCommand } | { ok: false; error: string } {
  const r = AnyCommandSchema.safeParse(obj)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, error: r.error.issues.map(i => i.message).join('; ') }
}
