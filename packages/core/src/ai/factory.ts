import type { PingoDb } from '../db/client'
import type { Logger } from '../logger'
import { recordUsage } from '../usage'
import { AiExtractor } from './extractor'
import { loadModelsConfig, type ModelsConfig } from './models-config'
import { OpenRouterClient } from './openrouter'

export interface CreateExtractorOptions {
  apiKey: string
  baseUrl?: string
  db: PingoDb
  config?: ModelsConfig
  clock?: () => Date
  log?: Logger
}

/** Extrator de produção: OpenRouter + registro de uso no banco local. */
export function createAiExtractor(o: CreateExtractorOptions): {
  extractor: AiExtractor
  config: ModelsConfig
} {
  const config = o.config ?? loadModelsConfig()
  const clock = o.clock ?? (() => new Date())
  const client = new OpenRouterClient({
    apiKey: o.apiKey,
    baseUrl: o.baseUrl,
    provider: config.provider,
    timeoutMs: config.limits.timeoutMs,
  })
  const extractor = new AiExtractor({
    client,
    config,
    log: o.log,
    onUsage: (u) => recordUsage(o.db, u, clock()),
  })
  return { extractor, config }
}
