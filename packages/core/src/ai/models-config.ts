import { z } from 'zod'
import type { AiRole } from '../db/schema'
import defaultConfig from '../../config/models.json'

/**
 * Configuração de modelos por função (R10.2). Os IDs ficam SOMENTE no JSON,
 * nunca no código (regra do projeto).
 */

const reasoningEffort = z.enum(['minimal', 'low', 'medium', 'high'])

const modelChoice = z.object({
  id: z.string().min(1),
  /** Esforço de raciocínio. Omitir para modelos que não aceitam o parâmetro. */
  reasoning: reasoningEffort.optional(),
})

const providerPrefs = z.object({
  sort: z.enum(['price', 'throughput', 'latency']).optional(),
  require_parameters: z.boolean().optional(),
  data_collection: z.enum(['allow', 'deny']),
  allow_fallbacks: z.boolean().optional(),
})

const modelsConfig = z.object({
  version: z.number(),
  roles: z.object({
    text: z.array(modelChoice).min(1),
    vision: z.array(modelChoice).min(1),
    pdf: z.array(modelChoice).min(1),
    audio: z.array(modelChoice).min(1),
  }),
  provider: providerPrefs,
  limits: z.object({
    maxOutputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    dailyUsd: z.number().nonnegative(),
    monthlyUsd: z.number().nonnegative(),
  }),
})

export type ModelChoice = z.infer<typeof modelChoice>
export type ProviderPrefs = z.infer<typeof providerPrefs>
export type ModelsConfig = z.infer<typeof modelsConfig>

/** Valida e devolve a configuração. Sem argumento, usa o `config/models.json` empacotado. */
export function loadModelsConfig(raw: unknown = defaultConfig): ModelsConfig {
  const cfg = modelsConfig.parse(raw)
  if (cfg.provider.data_collection !== 'deny') {
    // Regra do projeto: privacidade não é relaxada em silêncio.
    throw new Error('models.json: provider.data_collection deve ser "deny".')
  }
  for (const [role, list] of Object.entries(cfg.roles)) {
    for (const m of list) {
      if (/:batch$|:free$|^~/.test(m.id)) {
        throw new Error(`models.json: modelo "${m.id}" (${role}) não é permitido como padrão.`)
      }
    }
  }
  return cfg
}

export function modelsForRole(cfg: ModelsConfig, role: AiRole): ModelChoice[] {
  return cfg.roles[role]
}
