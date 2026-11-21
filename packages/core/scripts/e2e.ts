// Roteiro de verificação do orquestrador com IA real. Uso: pnpm --filter @pingo/core e2e
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import type { OutgoingMessage } from '@pingo/shared'
import { MemoryChannel, Orchestrator, createAiExtractor, schema, spentSince } from '../src'
import { openNodeDb } from './lib/node-db'

const here = dirname(fileURLToPath(import.meta.url))
const apiKey = process.env.OPENROUTER_API_KEY
if (!apiKey) throw new Error('OPENROUTER_API_KEY ausente em .env.local')

const OWNER = '+5511999990000'
const tz = 'America/Sao_Paulo'
let now = new Date('2026-11-07T21:00:00-03:00')

const db = await openNodeDb()
const channel = new MemoryChannel()
const { extractor, config } = createAiExtractor({
  apiKey,
  baseUrl: process.env.OPENROUTER_BASE_URL,
  db,
  clock: () => now,
})
const orch = new Orchestrator({
  db,
  channel,
  extractor,
  owner: { phone: OWNER, name: 'Hellena', tz },
  budget: config.limits,
  clock: () => now,
})
await orch.start()

await db
  .insert(schema.contacts)
  .values({ id: 'c1', name: 'Renato Souza', phone: '+5511988880000', status: 'active' })

let seq = 0
const text = (t: string, id = `m${++seq}`) =>
  channel.emit({
    type: 'message',
    channel: 'simulator',
    channelMsgId: id,
    fromPhone: OWNER,
    receivedAt: now.toISOString(),
    text: t,
  })
const press = (buttonId: string) =>
  channel.emit({
    type: 'button',
    channel: 'simulator',
    channelMsgId: `b${++seq}`,
    fromPhone: OWNER,
    receivedAt: now.toISOString(),
    buttonId,
  })

function show(label: string) {
  console.log(`\n--- ${label}`)
  for (const { message } of channel.drain()) console.log('  ' + describe(message))
}
function describe(m: OutgoingMessage): string {
  if (m.type === 'text') return `💬 ${m.text}`
  if (m.type === 'buttons') return `🔘 ${m.text} [${m.buttons.map((b) => b.title).join(' | ')}]`
  if (m.type === 'card') {
    const f = m.card.fields.map((x) => `${x.label}: ${x.value ?? 'não informado'}`).join(' · ')
    return `🗂️  [${m.card.kind}] ${m.card.title} — ${f} {${m.card.actions.map((a) => a.title).join('/')}}`
  }
  return JSON.stringify(m)
}
let fails = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}`)
  if (!ok) fails++
}
const itemsNow = () => db.select().from(schema.items)

// 1) Mensagem do vídeo → duas propostas
const original =
  'Oi famílias! Sexta-feira, 13/11, tem passeio ao zoológico. O Ravi precisa ir de tênis, boné e levar lanche. Autorização assinada até quarta.'
await text(original, 'wa-1')
show('1) mensagem do vídeo')
const rows = await itemsNow()
check(
  rows.length === 2 && rows.every((r) => r.status === 'proposed'),
  'criou 2 propostas (proposed)',
)

// 2) Idempotência: mesma mensagem de novo não duplica
await text(original, 'wa-1')
check(
  channel.drain().length === 0 && (await itemsNow()).length === 2,
  'mensagem repetida foi ignorada (idempotência)',
)

// 3) Confirmar o evento
const evento = rows.find((r) => r.kind === 'event')!
await press(`confirm:${evento.id}`)
show('3) confirmar o passeio')
check(
  (await db.select().from(schema.items).where(eq(schema.items.id, evento.id)).get())?.status ===
    'confirmed',
  'evento confirmado',
)

// 4) Editar a autorização por texto livre, passando para o Renato
const outro = rows.find((r) => r.id !== evento.id)!
await press(`edit:${outro.id}`)
show('4a) pedir edição')
await text('o prazo é quinta às 18h e passa para o Renato')
show('4b) edição aplicada')
const editado = (await db.select().from(schema.items).where(eq(schema.items.id, outro.id)).get())!
check(editado.assigneeContactId === 'c1', 'responsável virou Renato (casou com o contato)')
check(!!editado.dueAt || !!editado.startsAt, 'data atualizada')
check(editado.status === 'proposed', 'continua proposta até confirmar')

// 5) Descartar o que sobrou
await press(`discard:${outro.id}`)
show('5) descartar')
check(
  (await db.select().from(schema.items).where(eq(schema.items.id, outro.id)).get())?.status ===
    'discarded',
  'descartado',
)

// 6) Sem nada acionável
await text('Bom dia, pessoal! 🌞')
show('6) sem ação')
check((await itemsNow()).length === 2, 'não criou itens')

// 7) Imagem
channel.putMedia(
  'img1',
  new Uint8Array(readFileSync(join(here, '../fixtures/media/img-aviso.png'))),
)
await channel.emit({
  type: 'message',
  channel: 'simulator',
  channelMsgId: 'wa-img',
  fromPhone: OWNER,
  receivedAt: now.toISOString(),
  media: { kind: 'image', mimeType: 'image/png', sizeBytes: 27000, ref: 'img1' },
})
show('7) imagem')
check((await itemsNow()).length === 3, 'imagem gerou 1 proposta')

// 7b) Pergunta sobre a agenda (IA decide que é consulta, não recado)
const before = (await itemsNow()).length
await text('o que tenho sexta?')
{
  const sent = channel.drain().map((s) => describe(s.message))
  console.log('\n--- 7b) pergunta\n  ' + sent.join('\n  '))
  check(
    sent.some((s) => s.includes('passeio') || s.includes('Passeio')) &&
      (await itemsNow()).length === before,
    'respondeu com a agenda de sexta sem criar item',
  )
}
await text('o que tenho no dia 20?')
{
  const sent = channel.drain().map((s) => describe(s.message))
  check(
    sent.some((s) => s.includes('Nada marcado')) && (await itemsNow()).length === before,
    'dia vazio responde "Nada marcado"',
  )
}

// 8) Expiração em 48h
now = new Date(now.getTime() + 49 * 3600 * 1000)
const expired = await orch.expireStale()
check(
  expired === 1 && (await itemsNow()).filter((r) => r.status === 'expired').length === 1,
  'proposta parada expirou após 48 h',
)

// 9) Teto de custo
await db.insert(schema.settings).values({ key: 'cap_daily_usd', value: '0' })
await text('Reunião amanhã às 10h')
show('9) teto diário zerado')
check((await itemsNow()).length === 3, 'com teto estourado, nada foi processado')

// 10) Mensagem de outro número é ignorada
await channel.emit({
  type: 'message',
  channel: 'simulator',
  channelMsgId: 'x1',
  fromPhone: '+5500000000',
  receivedAt: now.toISOString(),
  text: 'oi',
})
check(channel.drain().length === 0, 'número desconhecido ignorado')

const cost = await spentSince(db, '1970-01-01T00:00:00Z')
console.log(`\nGasto total de IA no roteiro: US$${cost.toFixed(5)}`)
console.log(fails === 0 ? '\n✅ Tudo certo.' : `\n❌ ${fails} verificação(ões) falharam.`)
process.exit(fails === 0 ? 0 : 1)
