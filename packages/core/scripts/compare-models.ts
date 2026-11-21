// Compara modelos sobre o conjunto de referência (tarefa 1.11).
//
// Uso:
//   pnpm --filter @pingo/core compare                         # modelos do models.json, todas as funções
//   pnpm --filter @pingo/core compare --roles text            # só uma função
//   pnpm --filter @pingo/core compare --also "qwen/qwen3.7-flash,x-ai/foo@low"   # candidatos extras (id[@esforço])
//   pnpm --filter @pingo/core compare --only escola-passeio,pix                  # só alguns casos
//   pnpm --filter @pingo/core compare --verbose               # mostra as extrações com falha
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AiExtractor,
  OpenRouterClient,
  loadModelsConfig,
  type AiRole,
  type ModelChoice,
  type ModelsConfig,
} from '../src'
import { evaluate, type Expectation } from './lib/evaluate'

const here = dirname(fileURLToPath(import.meta.url))

interface Fixture {
  id: string
  now?: string
  input: {
    text?: string
    media?: { kind: 'image' | 'pdf' | 'audio'; mimeType: string; file: string }
  }
  expect: Expectation
  note?: string
}
interface FixtureFile {
  defaultNow: string
  tz: string
  fixtures: Fixture[]
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? (args[i + 1] ?? '') : undefined
}
const has = (name: string) => args.includes(`--${name}`)

const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('OPENROUTER_API_KEY ausente em .env.local')

const config = loadModelsConfig()
const file = JSON.parse(
  readFileSync(join(here, '../fixtures/messages.json'), 'utf8'),
) as FixtureFile
const only = flag('only')?.split(',').filter(Boolean)
const roles = (flag('roles')?.split(',').filter(Boolean) ?? [
  'text',
  'vision',
  'pdf',
  'audio',
]) as AiRole[]
const extra = flag('also')?.split(',').filter(Boolean).map(parseChoice) ?? []

function parseChoice(spec: string): ModelChoice {
  const [id, reasoning] = spec.split('@')
  return reasoning ? { id: id!, reasoning: reasoning as ModelChoice['reasoning'] } : { id: id! }
}

const client = new OpenRouterClient({
  apiKey,
  baseUrl: process.env.OPENROUTER_BASE_URL,
  provider: config.provider,
  timeoutMs: config.limits.timeoutMs,
})

function roleOf(f: Fixture): AiRole {
  const k = f.input.media?.kind
  return !k ? 'text' : k === 'image' ? 'vision' : k === 'pdf' ? 'pdf' : 'audio'
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x)
    }),
  )
}

interface Row {
  fixture: string
  pass: boolean
  reasons: string[]
  ms: number
  cost: number
  error?: string
  dump?: unknown
}

let grandTotal = 0

for (const role of roles) {
  const fixtures = file.fixtures.filter((f) => roleOf(f) === role && (!only || only.includes(f.id)))
  if (fixtures.length === 0) continue
  const candidates = [
    ...config.roles[role],
    ...extra.filter((c) => !config.roles[role].some((m) => m.id === c.id)),
  ]
  console.log(`\n=== Função: ${role} (${fixtures.length} casos) ===`)

  for (const choice of candidates) {
    const cfg: ModelsConfig = { ...config, roles: { ...config.roles, [role]: [choice] } }
    const rows: Row[] = []
    let cost = 0
    const extractor = new AiExtractor({
      client,
      config: cfg,
      onUsage: (u) => void (cost += u.costUsd),
    })

    await pool(fixtures, 4, async (f) => {
      const media = f.input.media
      const t0 = Date.now()
      const before = cost
      try {
        const out = await extractor.extract({
          text: f.input.text,
          media: media
            ? {
                kind: media.kind,
                mimeType: media.mimeType,
                data: new Uint8Array(readFileSync(join(here, '../fixtures', media.file))),
                filename: media.file.split('/').pop(),
              }
            : undefined,
          now: new Date(f.now ?? file.defaultNow),
          tz: file.tz,
        })
        const v = evaluate(out.extraction, f.expect, file.tz)
        rows.push({
          fixture: f.id,
          pass: v.pass,
          reasons: v.reasons,
          ms: Date.now() - t0,
          cost: cost - before,
          dump: v.pass ? undefined : out.extraction,
        })
      } catch (e) {
        rows.push({
          fixture: f.id,
          pass: false,
          reasons: [],
          ms: Date.now() - t0,
          cost: cost - before,
          error: e instanceof Error ? e.message.slice(0, 220) : String(e),
        })
      }
    })

    grandTotal += cost
    const passed = rows.filter((r) => r.pass).length
    const avg = Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length)
    const label = choice.reasoning ? `${choice.id}@${choice.reasoning}` : choice.id
    console.log(
      `\n${label}\n  acertos: ${passed}/${rows.length}  custo: US$${cost.toFixed(5)}  tempo médio: ${avg} ms`,
    )
    for (const r of rows
      .filter((x) => !x.pass)
      .sort((a, b) => a.fixture.localeCompare(b.fixture))) {
      console.log(`  ✗ ${r.fixture}: ${r.error ? `ERRO ${r.error}` : r.reasons.join('; ')}`)
      if (has('verbose') && r.dump) console.log(JSON.stringify(r.dump))
    }
  }
}
console.log(`\nCusto total da comparação: US$${grandTotal.toFixed(5)}`)
