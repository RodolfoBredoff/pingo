// Teste rápido do extrator com a chave real. Uso: pnpm --filter @pingo/core smoke
import { AiExtractor, OpenRouterClient, loadModelsConfig } from '../src'

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('OPENROUTER_API_KEY ausente em .env.local')

const config = loadModelsConfig()
const client = new OpenRouterClient({
  apiKey,
  baseUrl: process.env.OPENROUTER_BASE_URL,
  provider: config.provider,
  timeoutMs: config.limits.timeoutMs,
})

let total = 0
const extractor = new AiExtractor({
  client,
  config,
  onUsage: (u) => {
    total += u.costUsd
    console.log(
      `  [uso] ${u.role} ${u.model} in=${u.inputTokens} out=${u.outputTokens} US$${u.costUsd.toFixed(6)}`,
    )
  },
})

const text =
  'Oi famílias! Sexta-feira, 13/11, tem passeio ao zoológico. O Ravi precisa ir de tênis, boné e levar lanche. Autorização assinada até quarta.'

const out = await extractor.extract({
  text,
  now: new Date('2026-11-07T21:00:00-03:00'),
  tz: 'America/Sao_Paulo',
})
console.log(JSON.stringify(out, null, 2))
console.log(`custo total: US$${total.toFixed(6)}`)
