// Verificação determinística da Fase 3 (sem IA, sem custo): comandos, lembretes, contatos.
// Uso: pnpm --filter @pingo/core phase3
import { eq } from 'drizzle-orm'
import type { OutgoingMessage } from '@pingo/shared'
import {
  MemoryChannel,
  Orchestrator,
  schema,
  type ExtractResult,
  type Extractor,
  type RouteResult,
} from '../src'
import { openNodeDb } from './lib/node-db'

const OWNER = '+5511999990000'
const RENATO = '+5511988887777'
const tz = 'America/Sao_Paulo'
// Sábado, 7/11/2026, 21:00 (Brasília).
let now = new Date('2026-11-07T21:00:00-03:00')

/** Extrator falso: devolve o que o roteiro mandar. */
let nextItems: ExtractResult['extraction']['items'] = []
let nextRoute: RouteResult['route'] = {
  intent: 'other',
  from: null,
  to: null,
  scope: 'agenda',
  keyword: null,
}
const extractor: Extractor = {
  async extract() {
    return {
      extraction: { actionable: nextItems.length > 0, transcript: null, items: nextItems },
      role: 'text',
      model: 'stub',
    }
  },
  async patch() {
    throw new Error('patch não esperado')
  },
  async route() {
    return { route: nextRoute, model: 'stub' }
  },
}
const item = (over: Partial<ExtractResult['extraction']['items'][number]>) => ({
  kind: 'event' as const,
  title: 'Item',
  summary: null,
  start: null,
  end: null,
  all_day: false,
  due: null,
  location: null,
  assignee_hint: null,
  missing: [],
  confidence: 0.9,
  evidence: '',
  ...over,
})

const db = await openNodeDb()
const channel = new MemoryChannel()
const notified: string[] = []
const orch = new Orchestrator({
  db,
  channel,
  extractor,
  owner: { phone: OWNER, name: 'Hellena', tz },
  budget: { dailyUsd: 100, monthlyUsd: 100 },
  clock: () => now,
  reminderIntervalMs: 0,
  notifier: { notify: (t) => void notified.push(t) },
})
await orch.start()

let seq = 0
const say = (t: string, from = OWNER) =>
  orch.handle({
    type: 'message',
    channel: 'simulator',
    channelMsgId: `m${++seq}`,
    fromPhone: from,
    receivedAt: now.toISOString(),
    text: t,
  })
const press = (id: string, from = OWNER) =>
  orch.handle({
    type: 'button',
    channel: 'simulator',
    channelMsgId: `b${++seq}`,
    fromPhone: from,
    receivedAt: now.toISOString(),
    buttonId: id,
  })
const flat = (m: OutgoingMessage): string =>
  m.type === 'text'
    ? m.text
    : m.type === 'buttons'
      ? `${m.text} [${m.buttons.map((b) => b.id).join('|')}]`
      : m.type === 'list'
        ? `${m.text} {${m.rows.map((r) => `${r.id}:${r.title}`).join('|')}}`
        : m.type === 'card'
          ? `${m.card.title} <${m.card.actions.map((a) => a.id).join('|')}>`
          : JSON.stringify(m)
const take = () => channel.drain()
const toOwner = () =>
  take()
    .filter((s) => s.toPhone === OWNER)
    .map((s) => flat(s.message))
    .join('\n')

let fails = 0
const check = (ok: boolean, what: string, extra?: string) => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${!ok && extra ? `\n      ↳ ${extra}` : ''}`)
  if (!ok) fails++
}
const allItems = () => db.select().from(schema.items)
const pendingReminders = () =>
  db.select().from(schema.reminders).where(eq(schema.reminders.status, 'pending'))
const section = (s: string) => console.log(`\n--- ${s}`)

section('1) comandos básicos')
await say('ajuda')
check((await toOwner()).includes('hoje'), '"ajuda" lista os comandos')
await say('hoje')
check((await toOwner()).includes('Nada marcado'), '"hoje" sem itens')
await say('pendentes')
check((await toOwner()).includes('Nenhuma proposta'), '"pendentes" vazio')

section('2) contatos')
await say('adiciona Renato 11 98888-7777')
let out = await toOwner()
check(
  out.includes('Renato') && out.includes('+5511988887777'),
  'adiciona contato com telefone normalizado',
  out,
)
await say('adiciona Renato 11 98888-7777')
check((await toOwner()).includes('já está'), 'telefone repetido é recusado')
await say('adiciona Ana 12345678')
check((await toOwner()).includes('Não entendi'), 'telefone inválido é recusado')
await say('contatos')
check((await toOwner()).includes('aguardando aceite'), '"contatos" mostra status')

section('3) propostas → confirmar → lembretes')
nextItems = [
  item({
    kind: 'event',
    title: 'Passeio ao zoológico',
    start: '2026-11-13T08:00:00',
    location: 'Zoo',
  }),
  item({
    kind: 'authorization',
    title: 'Autorização assinada',
    due: '2026-11-11',
    all_day: true,
  }),
]
await say('Mensagem do grupo da escola')
take()
const rows = await allItems()
check(rows.length === 2 && rows.every((r) => r.status === 'proposed'), '2 propostas')
const evento = rows.find((r) => r.kind === 'event')!
const autor = rows.find((r) => r.kind === 'authorization')!
await press(`confirm:${evento.id}`)
out = await toOwner()
check(out.includes('Te aviso'), 'confirmação anuncia lembretes', out)
check(out.includes(`assign_pick:${evento.id}`), 'oferece "Passar para…" quando há contatos', out)
let rem = await pendingReminders()
check(
  rem.length === 2,
  'evento com hora: 2 lembretes (véspera 20h + 1 h antes)',
  String(rem.length),
)
const times = rem.map((r) => r.remindAt).sort()
check(
  times[0] === '2026-11-12T23:00:00.000Z' && times[1] === '2026-11-13T10:00:00.000Z',
  'horários certos (12/11 20:00 e 13/11 07:00, Brasília)',
  times.join(' '),
)
await press(`confirm:${autor.id}`)
take()
rem = await pendingReminders()
check(rem.length === 4, 'autorização: +2 lembretes (D-2 09h e dia 08h)', String(rem.length))

section('4) consultas')
await say('amanhã')
check((await toOwner()).includes('Nada marcado'), '"amanhã" vazio')
await say('semana')
out = await toOwner()
check(
  out.includes('Passeio ao zoológico') && out.includes('item:'),
  '"semana" lista itens clicáveis',
  out,
)
nextRoute = {
  intent: 'query',
  from: '2026-11-13',
  to: '2026-11-13',
  scope: 'agenda',
  keyword: null,
}
await say('o que tenho sexta?')
out = await toOwner()
check(out.includes('Passeio') && !out.includes('Autorização'), 'pergunta roteada para sexta', out)
nextRoute = { intent: 'other', from: null, to: null, scope: 'agenda', keyword: null }

section('5) disparo de lembretes')
now = new Date('2026-11-09T09:30:00-03:00') // D-2 da autorização, às 09:30
let sent = await orch.tickReminders()
out = await toOwner()
check(
  sent === 1 && out.includes('Autorização'),
  'lembrete D-2 da autorização disparou',
  `${sent} ${out}`,
)
check(notified.length === 1, 'notificação do sistema chamada')
sent = await orch.tickReminders()
check(sent === 0, 'não dispara de novo')

const lembreteMsg = (await db.select().from(schema.reminders)).find((r) => r.status === 'sent')!
await press(`rem_snooze1h:${lembreteMsg.id}`)
check((await toOwner()).includes('1 h'), 'adiar 1 h confirmado')
now = new Date('2026-11-09T10:45:00-03:00')
sent = await orch.tickReminders()
check(sent === 1, 'lembrete adiado disparou 1 h depois')
take()

await press(`rem_snoozetm:${lembreteMsg.id}`)
take()
check(
  (await pendingReminders()).some((r) => r.remindAt === '2026-11-10T12:00:00.000Z'),
  'adiar para amanhã 9h cria lembrete 10/11 12:00Z',
)

section('6) concluir e cancelar por texto')
await say('feito autorização')
out = await toOwner()
check(out.includes('Feito!'), '"feito autorização" conclui', out)
check((await allItems()).find((r) => r.id === autor.id)?.status === 'done', 'status = done')
check(
  !(await pendingReminders()).some((r) => r.itemId === autor.id),
  'lembretes do item concluído foram cancelados',
)
await say('feito xyz')
check((await toOwner()).includes('Não achei'), 'sem correspondência avisa')
await say('cancelar zoo')
out = await toOwner()
check(out.includes('Cancelei'), '"cancelar zoo" cancela', out)
check(
  (await pendingReminders()).filter((r) => r.itemId === evento.id).length === 0,
  'lembretes do cancelado removidos',
)

section('7) passar para contato (opt-in)')
nextItems = [
  item({ kind: 'task', title: 'Levar bolo', start: '2026-11-12T00:00:00', all_day: true }),
]
await say('Preciso levar o bolo quinta')
take()
const bolo = (await allItems()).find((r) => r.title === 'Levar bolo')!
await press(`confirm:${bolo.id}`)
take()
await press(`assign_pick:${bolo.id}`)
out = await toOwner()
const contactRow = (await db.select().from(schema.contacts))[0]!
check(out.includes(`assign:${bolo.id}:${contactRow.id}`), 'lista de contatos aparece', out)
await press(`assign:${bolo.id}:${contactRow.id}`)
let sentAll = take()
const offer = sentAll.find((s) => s.toPhone === RENATO)
check(!!offer && flat(offer.message).includes('offer_yes'), 'oferta enviada ao contato com botões')
check(
  !!offer && flat(offer.message).includes('Posso te mandar recados'),
  'primeira mensagem pede permissão (opt-in)',
)
const asgId = (await db.select().from(schema.assignments))[0]!.id
await say('oi', RENATO)
check(
  take().some((s) => s.toPhone === RENATO),
  'contato que digita texto recebe orientação',
)
await press(`offer_yes:${asgId}`, RENATO)
sentAll = take()
check(
  sentAll.some((s) => s.toPhone === OWNER && flat(s.message).includes('aceitou')),
  'dono é avisado do aceite',
)
check(
  (await db.select().from(schema.contacts))[0]!.status === 'active',
  'contato virou ativo (opt-in registrado)',
)
await press(`offer_yes:${asgId}`, RENATO)
check(
  take().some((s) => s.toPhone === RENATO && flat(s.message).includes('já foi respondida')),
  'resposta repetida é ignorada',
)

now = new Date('2026-11-11T09:30:00-03:00') // véspera do bolo, 09h
await orch.tickReminders()
sentAll = take()
check(
  sentAll.some((s) => s.toPhone === RENATO && flat(s.message).includes('Levar bolo')),
  'lembrete também vai ao contato que aceitou',
)

section('8) contato recusa e número desconhecido')
nextItems = [
  item({ kind: 'task', title: 'Comprar flores', start: '2026-11-20T00:00:00', all_day: true }),
]
await say('Comprar flores dia 20')
take()
const flores = (await allItems()).find((r) => r.title === 'Comprar flores')!
await press(`confirm:${flores.id}`)
take()
await press(`assign:${flores.id}:${contactRow.id}`)
take()
const asg2 = (await db.select().from(schema.assignments)).find((a) => a.itemId === flores.id)!
await press(`offer_no:${asg2.id}`, RENATO)
sentAll = take()
check(
  sentAll.some((s) => s.toPhone === OWNER && flat(s.message).includes('não pode')),
  'dono é avisado da recusa',
)
check(
  (await allItems()).find((r) => r.id === flores.id)?.assigneeContactId === null,
  'item volta a ser do dono',
)
await say('oi', '+5500000000')
check(take().length === 0, 'número desconhecido ignorado')

section('9) expirar e reabrir com "pendentes"')
nextItems = [item({ kind: 'task', title: 'Pagar boleto', due: '2026-11-30', all_day: true })]
await say('Pagar boleto até dia 30')
take()
now = new Date(now.getTime() + 49 * 3600_000)
await orch.expireStale()
check((await allItems()).find((r) => r.title === 'Pagar boleto')?.status === 'expired', 'expirou')
await say('pendentes')
out = await toOwner()
check(out.includes('Pagar boleto'), '"pendentes" reabre proposta expirada', out)
check(
  (await allItems()).find((r) => r.title === 'Pagar boleto')?.status === 'proposed',
  'voltou a "proposed"',
)

section('10) remover contato')
await say('remove contato Renato')
check((await toOwner()).includes('Removi'), 'contato removido')

console.log(fails === 0 ? '\n✅ Fase 3 (core) ok.' : `\n❌ ${fails} verificação(ões) falharam.`)
process.exit(fails === 0 ? 0 : 1)
