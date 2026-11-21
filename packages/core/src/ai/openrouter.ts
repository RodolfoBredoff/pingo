import type { ModelChoice, ProviderPrefs } from './models-config'

/**
 * Cliente mínimo do OpenRouter (API compatível com OpenAI).
 * - Nunca registra conteúdo de mensagens nem a chave.
 * - `baseUrl` configurável: dá para apontar a um servidor local compatível (ex.: Ollama).
 */

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface ChatRequest {
  model: ModelChoice
  messages: ChatMessage[]
  /** Quando presente, exige JSON Schema estrito na resposta. */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  maxTokens: number
  /** Para PDFs em modelos sem leitura nativa de arquivo. */
  pdfEngine?: 'pdf-text' | 'mistral-ocr' | 'native'
}

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface ChatResult {
  content: string | null
  /** Modelo que realmente respondeu. */
  model: string
  provider?: string
  finishReason?: string
  usage: ChatUsage
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

export interface OpenRouterOptions {
  apiKey: string
  baseUrl?: string
  provider: ProviderPrefs
  timeoutMs?: number
  fetch?: typeof fetch
  appName?: string
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

export class OpenRouterClient {
  private readonly baseUrl: string
  private readonly doFetch: typeof fetch

  constructor(private readonly opts: OpenRouterOptions) {
    if (!opts.apiKey) throw new OpenRouterError('Chave do OpenRouter ausente.')
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.doFetch = opts.fetch ?? ((...a) => fetch(...a))
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: req.model.id,
      messages: req.messages,
      max_tokens: req.maxTokens,
      usage: { include: true },
      provider: this.opts.provider,
    }
    if (req.model.reasoning) {
      // `exclude` evita devolver o texto do raciocínio; os tokens continuam contando.
      body.reasoning = { effort: req.model.reasoning, exclude: true }
    }
    if (req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
      }
    }
    if (req.pdfEngine && req.pdfEngine !== 'native') {
      body.plugins = [{ id: 'file-parser', pdf: { engine: req.pdfEngine } }]
    }

    // Uma retentativa para falhas transitórias (429/5xx).
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send(body)
      } catch (e) {
        if (e instanceof OpenRouterError && e.retryable && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        throw e
      }
    }
  }

  private async send(body: Record<string, unknown>): Promise<ChatResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000)
    let res: Response
    try {
      res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': this.opts.appName ?? 'Pingo',
        },
        body: JSON.stringify(body),
      })
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError'
      throw new OpenRouterError(
        aborted ? 'Tempo esgotado ao falar com o OpenRouter.' : 'Falha de rede com o OpenRouter.',
        undefined,
        true,
      )
    } finally {
      clearTimeout(timer)
    }

    const json = (await res.json().catch(() => null)) as OpenRouterResponse | null
    if (!res.ok || json?.error) {
      const status = res.status
      const msg = json?.error?.message ?? `HTTP ${status}`
      throw new OpenRouterError(msg, status, status === 429 || status >= 500)
    }

    const choice = json?.choices?.[0]
    return {
      content: choice?.message?.content ?? null,
      model: json?.model ?? String(body.model),
      provider: json?.provider,
      finishReason: choice?.finish_reason,
      usage: {
        inputTokens: json?.usage?.prompt_tokens ?? 0,
        outputTokens: json?.usage?.completion_tokens ?? 0,
        costUsd: json?.usage?.cost ?? 0,
      },
    }
  }
}

interface OpenRouterResponse {
  model?: string
  provider?: string
  error?: { message?: string }
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
}
