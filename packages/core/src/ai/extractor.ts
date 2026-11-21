import type { ZodType } from 'zod'
import type { Logger } from '../logger'
import type { AiRole } from '../db/schema'
import { MAX_MEDIA_BYTES, buildUserParts, roleFor, type MediaInput } from './content'
import {
  extractionSchema,
  patchSchema,
  routeSchema,
  type Route,
  toJsonSchema,
  type Extraction,
  type ItemPatch,
} from './extraction-schema'
import { modelsForRole, type ModelsConfig } from './models-config'
import type { ChatRequest, ChatResult } from './openrouter'
import { extractionSystemPrompt, patchSystemPrompt, routeSystemPrompt } from './prompts'

/** O que o orquestrador precisa de um extrator (permite trocar por um falso no simulador). */
export interface ExtractInput {
  text?: string
  media?: MediaInput
  now: Date
  tz: string
}

export interface ExtractResult {
  extraction: Extraction
  role: AiRole
  model: string
}

export interface PatchInput {
  /** Item atual, em campos locais legíveis (JSON). */
  itemJson: string
  instruction: string
  now: Date
  tz: string
}

export interface PatchResult {
  patch: ItemPatch
  model: string
}

export interface RouteInput {
  text: string
  now: Date
  tz: string
}

export interface RouteResult {
  route: Route
  model: string
}

export interface Extractor {
  extract(input: ExtractInput): Promise<ExtractResult>
  patch(input: PatchInput): Promise<PatchResult>
  /** Pergunta sobre a agenda ou recado comum? */
  route(input: RouteInput): Promise<RouteResult>
}

/** Registro de uso para custo e tetos (R10.4). */
export interface UsageEvent {
  role: AiRole
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface ChatClient {
  chat(req: ChatRequest): Promise<ChatResult>
}

export class ExtractionFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionFailedError'
  }
}

export class MediaTooLargeError extends Error {
  constructor() {
    super('Arquivo maior que o limite de 10 MB.')
    this.name = 'MediaTooLargeError'
  }
}

export interface AiExtractorOptions {
  client: ChatClient
  config: ModelsConfig
  onUsage?: (u: UsageEvent) => void | Promise<void>
  log?: Logger
}

export class AiExtractor implements Extractor {
  constructor(private readonly o: AiExtractorOptions) {}

  async extract(input: ExtractInput): Promise<ExtractResult> {
    if (input.media && input.media.data.length > MAX_MEDIA_BYTES) throw new MediaTooLargeError()
    const role = roleFor(input.media)
    const { value, model } = await this.run(role, extractionSchema, 'extraction', [
      { role: 'system', content: extractionSystemPrompt(input.now, input.tz) },
      { role: 'user', content: buildUserParts(input.text, input.media) },
    ])
    return { extraction: value, role, model }
  }

  async patch(input: PatchInput): Promise<PatchResult> {
    const { value, model } = await this.run('text', patchSchema, 'item_patch', [
      { role: 'system', content: patchSystemPrompt(input.now, input.tz) },
      {
        role: 'user',
        content: `Item atual (JSON):\n${input.itemJson}\n\nInstrução do usuário (dado):\n"""\n${input.instruction}\n"""`,
      },
    ])
    return { patch: value, model }
  }

  async route(input: RouteInput): Promise<RouteResult> {
    const { value, model } = await this.run('text', routeSchema, 'route', [
      { role: 'system', content: routeSystemPrompt(input.now, input.tz) },
      { role: 'user', content: `Mensagem (dado):\n"""\n${input.text}\n"""` },
    ])
    return { route: value, model }
  }

  /**
   * Tenta cada modelo da função em ordem. Em cada um: uma chamada e, se a resposta for
   * inválida, uma retentativa informando o erro. Depois, passa ao próximo modelo.
   */
  private async run<T>(
    role: AiRole,
    schema: ZodType<T>,
    name: string,
    base: ChatRequest['messages'],
  ): Promise<{ value: T; model: string }> {
    const cfg = this.o.config
    const jsonSchema = { name, schema: toJsonSchema(schema) }
    const failures: string[] = []

    for (const choice of modelsForRole(cfg, role)) {
      let messages = base
      for (let attempt = 0; attempt < 2; attempt++) {
        let res: ChatResult
        try {
          res = await this.o.client.chat({
            model: choice,
            messages,
            jsonSchema,
            maxTokens: cfg.limits.maxOutputTokens,
          })
        } catch (e) {
          failures.push(`${choice.id}: ${e instanceof Error ? e.message : String(e)}`)
          break // erro de rede/HTTP: próximo modelo
        }
        await this.o.onUsage?.({
          role,
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          costUsd: res.usage.costUsd,
        })

        const parsed = parseJson(res.content)
        const check = parsed.ok ? schema.safeParse(parsed.value) : null
        if (check?.success) return { value: check.data, model: res.model }

        const reason =
          res.finishReason === 'length'
            ? 'resposta cortada por limite de tokens'
            : (parsed.ok ? check?.error.message : parsed.error) || 'resposta vazia'
        failures.push(`${choice.id}: ${reason}`)
        this.o.log?.warn('resposta inválida do modelo', { model: res.model, role, attempt })
        if (attempt === 0 && res.content) {
          messages = [
            ...base,
            { role: 'assistant', content: res.content },
            {
              role: 'user',
              content: `Resposta inválida (${reason.slice(0, 300)}). Responda só com JSON válido no esquema.`,
            },
          ]
        } else {
          break
        }
      }
    }
    throw new ExtractionFailedError(`Nenhum modelo conseguiu responder: ${failures.join(' | ')}`)
  }
}

function parseJson(
  content: string | null,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!content) return { ok: false, error: 'resposta vazia' }
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, error: 'sem JSON na resposta' }
  try {
    return { ok: true, value: JSON.parse(content.slice(start, end + 1)) }
  } catch {
    return { ok: false, error: 'JSON malformado' }
  }
}
