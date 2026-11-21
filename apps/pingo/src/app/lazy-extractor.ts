import {
  createAiExtractor,
  type ExtractInput,
  type ExtractResult,
  type Extractor,
  type PatchInput,
  type PatchResult,
  type PingoDb,
  type RouteInput,
  type RouteResult,
} from '@pingo/core'
import { secrets } from '../db/secrets'

export class MissingKeyError extends Error {
  constructor() {
    super('Chave do OpenRouter ausente. Configure em Ajustes.')
    this.name = 'MissingKeyError'
  }
}

export interface RunInfo {
  role: string
  model: string
  json: unknown
}

/**
 * Lê a chave do keychain a cada uso, então salvar a chave em Ajustes vale na hora,
 * sem reiniciar o app. A chave nunca fica guardada em variável global.
 */
export class LazyExtractor implements Extractor {
  private cached: { key: string; extractor: Extractor } | null = null

  constructor(
    private readonly db: PingoDb,
    private readonly clock: () => Date,
    private readonly onRun?: (r: RunInfo) => void,
  ) {}

  private async get(): Promise<Extractor> {
    const key = await secrets.get('openrouter_api_key')
    if (!key) throw new MissingKeyError()
    if (this.cached?.key !== key) {
      const { extractor } = createAiExtractor({ apiKey: key, db: this.db, clock: this.clock })
      this.cached = { key, extractor }
    }
    return this.cached.extractor
  }

  async extract(input: ExtractInput): Promise<ExtractResult> {
    const r = await (await this.get()).extract(input)
    this.onRun?.({ role: r.role, model: r.model, json: r.extraction })
    return r
  }

  async patch(input: PatchInput): Promise<PatchResult> {
    const r = await (await this.get()).patch(input)
    this.onRun?.({ role: 'text', model: r.model, json: r.patch })
    return r
  }

  async route(input: RouteInput): Promise<RouteResult> {
    const r = await (await this.get()).route(input)
    this.onRun?.({ role: 'text', model: r.model, json: r.route })
    return r
  }
}
