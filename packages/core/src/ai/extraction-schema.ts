import { z } from 'zod'

/**
 * Contrato entre o modelo de IA e o resto do sistema.
 * Todos os campos são obrigatórios (aceitando null) por exigência do modo estrito de JSON Schema.
 */

export const ITEM_KINDS = ['task', 'event', 'deadline', 'authorization', 'payment', 'info'] as const

const extractedItem = z.object({
  kind: z.enum(ITEM_KINDS),
  title: z.string(),
  summary: z.string().nullable(),
  /** ISO local sem fuso: "YYYY-MM-DDTHH:mm:ss", ou "YYYY-MM-DD" quando não há hora. */
  start: z.string().nullable(),
  end: z.string().nullable(),
  all_day: z.boolean(),
  /** Prazo final (entregar, pagar, responder). */
  due: z.string().nullable(),
  location: z.string().nullable(),
  assignee_hint: z.string().nullable(),
  missing: z.array(z.enum(['when', 'where', 'who'])),
  confidence: z.number(),
  evidence: z.string(),
})

export const extractionSchema = z.object({
  actionable: z.boolean(),
  transcript: z.string().nullable(),
  items: z.array(extractedItem),
})

export const patchSchema = z.object({
  kind: z.enum(ITEM_KINDS).nullable(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  all_day: z.boolean().nullable(),
  due: z.string().nullable(),
  location: z.string().nullable(),
  assignee_hint: z.string().nullable(),
  /** Campos que o usuário pediu para apagar. */
  clear: z.array(z.enum(['start', 'end', 'due', 'location', 'assignee'])),
})

/** Decide se a mensagem é uma pergunta sobre a agenda (e qual período) ou um recado comum. */
export const routeSchema = z.object({
  intent: z.enum(['query', 'other']),
  /** "YYYY-MM-DD" local, inclusive. */
  from: z.string().nullable(),
  to: z.string().nullable(),
  scope: z.enum(['agenda', 'pending', 'done', 'all']),
  /** Tema específico citado (ex.: "dentista"). */
  keyword: z.string().nullable(),
})

export type ExtractedItem = z.infer<typeof extractedItem>
export type Extraction = z.infer<typeof extractionSchema>
export type ItemPatch = z.infer<typeof patchSchema>
export type Route = z.infer<typeof routeSchema>

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete json.$schema
  return json
}
