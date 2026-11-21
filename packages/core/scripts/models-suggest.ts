export {}

// Lista os modelos mais baratos por modalidade, a partir do catálogo PÚBLICO do OpenRouter (R10.6).
// Não usa chave. Uso: pnpm --filter @pingo/core models:suggest [--top 8]
//
// Exclui de propósito: variantes :batch e :free, aliases "~...", modelos com expiração e
// modelos sem saída estruturada. Preço baixo NÃO garante qualidade: valide com `pnpm compare`.

interface CatalogModel {
  id: string
  context_length: number
  expiration_date: string | null
  architecture: { input_modalities: string[] }
  pricing: { prompt: string; completion: string }
  supported_parameters: string[]
}

const args = process.argv.slice(2)
const topIdx = args.indexOf('--top')
const topN = topIdx >= 0 ? Number(args[topIdx + 1]) || 8 : 8
const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(
  /\/+$/,
  '',
)

const res = await fetch(`${baseUrl}/models`)
if (!res.ok) throw new Error(`Catálogo indisponível (HTTP ${res.status}).`)
const { data } = (await res.json()) as { data: CatalogModel[] }

const eligible = data.filter(
  (m) =>
    !/:batch|:free|^~/.test(m.id) &&
    !m.expiration_date &&
    m.supported_parameters.includes('structured_outputs') &&
    Number(m.pricing.prompt) > 0,
)

const groups: [string, string, string][] = [
  ['text', 'texto', 'text'],
  ['vision', 'imagem', 'image'],
  ['pdf', 'PDF (arquivo)', 'file'],
  ['audio', 'áudio', 'audio'],
]

for (const [, label, modality] of groups) {
  const list = eligible
    .filter((m) => m.architecture.input_modalities.includes(modality))
    .sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt))
    .slice(0, topN)
  console.log(`\n== ${label} (US$ por 1 M de tokens: entrada / saída, contexto)`)
  for (const m of list) {
    const inp = (Number(m.pricing.prompt) * 1e6).toFixed(3)
    const out = (Number(m.pricing.completion) * 1e6).toFixed(3)
    console.log(
      `  ${inp.padStart(7)} / ${out.padStart(7)}  ${String(m.context_length).padStart(8)}  ${m.id}`,
    )
  }
}
console.log(
  '\nPara testar um candidato: pnpm --filter @pingo/core compare --roles text --also "id@esforço"',
)
