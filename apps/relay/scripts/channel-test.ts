// Teste integrado do canal WhatsApp: relay (handlers reais, AWS e Meta em memória) + RelayChannel +
// orquestrador. O caminho completo: webhook assinado → fila → app → resposta → "Meta".
// Sem rede, sem custo, sem IA. Uso: pnpm --filter @pingo/relay test:channel
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  MemoryChannel,
  MultiChannel,
  Orchestrator,
  RelayChannel,
  RelayError,
  pairRelay,
  renderCardText,
  schema,
  splitText,
  toWire,
  type ExtractInput,
  type Extractor,
  type RelayStatus,
} from '@pingo/core'
import { openNodeDb } from '../../../packages/core/scripts/lib/node-db'
import {
  ack,
  allowlist,
  deleteReminder,
  eraseMe,
  inbox,
  media,
  outbox,
  pair,
  putReminder,
} from '../src/handlers/device'
import { webhook } from '../src/handlers/webhook'
import { guard, sha256Hex, type HttpEvent, type HttpResult } from '../src/http'
import { makeHarness } from '../src/testing/memory'
import { WaError } from '../src/ports'

let fails = 0
const check = (ok: boolean, what: string, extra?: unknown) => {
  console.log(
    `  ${ok ? '✅' : '❌'} ${what}${!ok && extra !== undefined ? `\n      ↳ ${JSON.stringify(extra)}` : ''}`,
  )
  if (!ok) fails++
}
const section = (s: string) => console.log(`\n--- ${s}`)
const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms))
async function until(cond: () => boolean | Promise<boolean>, ms = 4000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await cond()) return true
    await wait(10)
  }
  return cond()
}

const OWNER = '+5511988887777'
const RENATO = '+5511977776666'
const SECRET = 'segredo-de-teste-do-app'
const BASE = 'https://relay.test'
const tz = 'America/Sao_Paulo'

// ---------------------------------------------------------------- relay em memória
const H = makeHarness()
const handlers: Record<string, (e: HttpEvent) => Promise<HttpResult>> = {
  pair: guard(() => H.deps, pair),
  inbox: guard(() => H.deps, inbox),
  ack: guard(() => H.deps, ack),
  outbox: guard(() => H.deps, outbox),
  media: guard(() => H.deps, media),
  allowlist: guard(() => H.deps, allowlist),
  putReminder: guard(() => H.deps, putReminder),
  deleteReminder: guard(() => H.deps, deleteReminder),
  eraseMe: guard(() => H.deps, eraseMe),
  webhook: guard(() => H.deps, webhook),
}
const ROUTES: [string, RegExp, keyof typeof handlers, string[]][] = [
  ['POST', /^\/device\/pair$/, 'pair', []],
  ['GET', /^\/inbox$/, 'inbox', []],
  ['POST', /^\/inbox\/ack$/, 'ack', []],
  ['POST', /^\/outbox$/, 'outbox', []],
  ['GET', /^\/media\/([^/]+)$/, 'media', ['id']],
  ['PUT', /^\/allowlist$/, 'allowlist', []],
  ['PUT', /^\/reminders\/([^/]+)$/, 'putReminder', ['id']],
  ['DELETE', /^\/reminders\/([^/]+)$/, 'deleteReminder', ['id']],
  ['DELETE', /^\/me$/, 'eraseMe', []],
]

let relayDown = false
const requests: { method: string; path: string; body?: unknown }[] = []

/** fetch que entrega direto aos handlers do relay, como o API Gateway faria. */
const fakeFetch = (async (input: string | URL, init: RequestInit = {}) => {
  if (relayDown) throw new TypeError('network down')
  const url = new URL(String(input))
  if (url.hostname === 'files.test') {
    const obj = H.files.objects.get(url.pathname.slice(1))
    return obj
      ? new Response(Buffer.from(obj.data), { status: 200 })
      : new Response('', { status: 404 })
  }
  const method = (init.method ?? 'GET').toUpperCase()
  for (const [m, re, name, keys] of ROUTES) {
    const match = re.exec(url.pathname)
    if (m !== method || !match) continue
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>))
      headers[k.toLowerCase()] = v
    const body = init.body ? String(init.body) : undefined
    requests.push({ method, path: url.pathname, body: body ? JSON.parse(body) : undefined })
    const res = await handlers[name]!({
      headers,
      body,
      isBase64Encoded: false,
      queryStringParameters: Object.fromEntries(url.searchParams),
      pathParameters: Object.fromEntries(
        keys.map((k, i) => [k, decodeURIComponent(match[i + 1]!)]),
      ),
    })
    return new Response(res.body as string, { status: res.statusCode ?? 200 })
  }
  return new Response('{"error":"not_found"}', { status: 404 })
}) as unknown as typeof fetch

/** A Meta chamando o webhook, com assinatura. */
async function metaSends(messages: unknown[]): Promise<number> {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] })
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex')
  const r = await handlers.webhook!({
    headers: { 'x-hub-signature-256': sig },
    body: raw,
    isBase64Encoded: false,
    requestContext: { http: { method: 'POST' } },
  } as HttpEvent)
  return r.statusCode ?? 0
}
let seq = 0
const ts = () => String(Math.floor(H.clock.now.getTime() / 1000))
const waText = (from: string, body: string, id = `wamid.T${++seq}`) => ({
  id,
  from: from.replace('+', ''),
  timestamp: ts(),
  type: 'text',
  text: { body },
})
const waButton = (from: string, id: string) => ({
  id: `wamid.B${++seq}`,
  from: from.replace('+', ''),
  timestamp: ts(),
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id, title: 'x' } },
})
const waQuick = (from: string, payload: string) => ({
  id: `wamid.Q${++seq}`,
  from: from.replace('+', ''),
  timestamp: ts(),
  type: 'button',
  button: { payload, text: 'x' },
})

// ------------------------------------------------------------------- app em memória
type Extracted = Awaited<ReturnType<Extractor['extract']>>['extraction']['items']
let nextItems: Extracted = []
let lastExtractValue: ExtractInput | null = null
const lastExtract = () => lastExtractValue
const extractor: Extractor = {
  async extract(input) {
    lastExtractValue = input
    return {
      extraction: { actionable: nextItems.length > 0, transcript: null, items: nextItems },
      role: 'text',
      model: 'stub',
    }
  },
  async patch() {
    throw new Error('não esperado')
  },
  async route() {
    return {
      route: { intent: 'other', from: null, to: null, scope: 'agenda', keyword: null },
      model: 'stub',
    }
  },
}
const item = (over: Record<string, unknown>) => ({
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
await db
  .insert(schema.owner)
  .values({ id: 1, phone: OWNER, name: 'Hellena', tz, consentAt: H.clock.now.toISOString() })

const statuses: RelayStatus[] = []
let token: string | null = null
const relay = new RelayChannel({
  baseUrl: BASE,
  getToken: async () => token,
  fetchFn: fakeFetch,
  pollWaitSec: 0,
  idleDelayMs: 5,
  onStatus: (s) => statuses.push(s),
  sleep: (ms) => wait(Math.min(ms, 20)),
})
const orch = new Orchestrator({
  db,
  channel: relay,
  extractor,
  owner: { phone: OWNER, name: 'Hellena', tz },
  budget: { dailyUsd: 100, monthlyUsd: 100 },
  clock: () => H.clock.now,
  reminderIntervalMs: 0,
})

// ===================================================================== 1) pareamento
section('1) pareamento')
const CODE = 'ABCD-EFGH-JKLM-NPQR-STUV'
let err: unknown
try {
  await pairRelay({ baseUrl: BASE, code: CODE, fetchFn: fakeFetch })
} catch (e) {
  err = e
}
check(err instanceof RelayError && err.status === 401, 'código desconhecido → RelayError 401')
await H.db.put({
  pk: 'PAIR',
  sk: sha256Hex(CODE.replace(/-/g, '')),
  expiresMs: H.clock.now.getTime() + 600_000,
})
token = await pairRelay({ baseUrl: BASE, code: CODE, fetchFn: fakeFetch })
check(typeof token === 'string' && token.length >= 40, 'código válido devolve o token')
await relay.syncAllowlist(OWNER, [])
check(!!(await H.db.get('ALLOW', OWNER)), 'lista de permitidos sincronizada (dono)')

// ================================================================ 2) recebimento
section('2) mensagem do WhatsApp chega ao app e a resposta volta')
await orch.start()
check(
  await until(() => relay.status === 'online'),
  'canal online (long polling funcionando)',
  statuses,
)
nextItems = [item({ title: 'Dentista', start: '2026-11-12T15:00:00', location: 'Centro' })]
check(
  (await metaSends([waText(OWNER, 'Dentista quinta às 15h')])) === 200,
  'webhook assinado aceito',
)
check(await until(() => H.wa.sent.length >= 2), 'o app respondeu pelo relay', H.wa.sent.length)
const sentTypes = H.wa.sent.map((p) => (p as { type: string }).type)
check(sentTypes[0] === 'text', 'primeiro o texto de introdução')
const cardMsg = H.wa.sent[1] as {
  type: string
  interactive: {
    type: string
    body: { text: string }
    action: { buttons: { reply: { id: string; title: string } }[] }
  }
}
check(
  cardMsg.type === 'interactive' && cardMsg.interactive.type === 'button',
  'o cartão vira mensagem com botões',
)
check(
  cardMsg.interactive.body.text.includes('Dentista') &&
    cardMsg.interactive.body.text.includes('Quando:') &&
    cardMsg.interactive.body.text.includes('Centro'),
  'com título, quando e onde',
)
const ids = cardMsg.interactive.action.buttons.map((b) => b.reply.id)
check(
  ids.length === 3 && ids[0]!.startsWith('confirm:') && ids[2]!.startsWith('discard:'),
  'botões Confirmar / Editar / Descartar',
)
check(await until(() => H.queue.all.length === 0), 'a mensagem foi confirmada (ack) e saiu da fila')
const row = (await db.select().from(schema.items))[0]!
check(row.status === 'proposed' && row.title === 'Dentista', 'proposta criada no banco local')
const msgRow = (await db.select().from(schema.messages))[0]
check(
  msgRow?.channel === 'whatsapp' && msgRow.fromPhone === OWNER,
  'mensagem gravada como canal whatsapp, número canônico',
)

section('3) botão tocado no WhatsApp')
H.wa.sent.length = 0
await metaSends([waButton(OWNER, ids[0]!)])
check(
  await until(
    async () =>
      (await db.select().from(schema.items).where(eq(schema.items.id, row.id)).get())?.status ===
      'confirmed',
  ),
  'Confirmar no WhatsApp confirma o item',
)
check(await until(() => H.wa.sent.length >= 1), 'e o Pingo responde')
check((await db.select().from(schema.reminders)).length >= 1, 'lembretes locais agendados')

section('4) mensagem repetida pela Meta')
const dupId = 'wamid.DUP1'
nextItems = [item({ title: 'Reunião', start: '2026-11-13T10:00:00' })]
await metaSends([waText(OWNER, 'Reunião sexta 10h', dupId)])
await until(() => H.queue.all.length === 0)
await metaSends([waText(OWNER, 'Reunião sexta 10h', dupId)])
await wait(100)
check(
  (await db.select().from(schema.items)).filter((i) => i.title === 'Reunião').length === 1,
  'processada uma vez só (R1.4)',
)

// ======================================================================== 5) mídia
section('5) mídia')
H.wa.media.set('900001', { data: new Uint8Array([1, 2, 3, 4, 5]), mimeType: 'image/png' })
nextItems = [item({ title: 'Aviso da escola', start: '2026-11-14T09:00:00' })]
await metaSends([
  {
    id: 'wamid.IMG1',
    from: OWNER.replace('+', ''),
    timestamp: ts(),
    type: 'image',
    image: { id: '900001', mime_type: 'image/png', caption: 'olha isso' },
  },
])
check(
  await until(() => lastExtract()?.media?.data.length === 5),
  'o app baixou a mídia pelo relay e a entregou à extração',
  lastExtract()?.media?.data.length,
)
check(
  lastExtract()?.media?.kind === 'image' && lastExtract()?.text === 'olha isso',
  'com o tipo e a legenda',
)

// ============================================================== 6) contato e modelos
section('6) contato: oferta, modelo de reserva e resposta')
async function say(text: string) {
  await metaSends([waText(OWNER, text)])
}
H.wa.sent.length = 0
await say('adiciona Renato 11 97777-6666')
await until(() => H.wa.sent.length >= 1)
const contactRow = (await db.select().from(schema.contacts))[0]!
await relay.syncAllowlist(OWNER, [contactRow.phone])
check(contactRow.phone === RENATO, 'contato cadastrado')
check((await H.db.get('ALLOW', RENATO))?.role === 'contact', 'e liberado no relay como contato')

const dentist = (await db.select().from(schema.items)).find((i) => i.title === 'Dentista')!
H.wa.sent.length = 0
await metaSends([waButton(OWNER, `assign:${dentist.id}:${contactRow.id}`)])
await until(() => H.wa.sent.some((p) => (p as { to: string }).to === RENATO.replace('+', '')))
const offer = H.wa.sent.find((p) => (p as { to: string }).to === RENATO.replace('+', '')) as {
  type: string
  template: {
    name: string
    components: { type: string; parameters: { text?: string; payload?: string }[] }[]
  }
}
check(
  offer?.type === 'template' && offer.template.name === 'oferta_responsabilidade',
  'contato nunca falou conosco: a oferta vai como MODELO',
)
const vars = offer.template.components.find((c) => c.type === 'body')!.parameters.map((p) => p.text)
check(
  vars[0] === 'Renato' && vars[1] === 'Hellena' && vars[2] === 'Dentista',
  'variáveis: contato, dono e item',
  vars,
)
const payloads = offer.template.components
  .filter((c) => c.type === 'button')
  .map((c) => c.parameters[0]!.payload!)
check(
  payloads.length === 2 &&
    payloads[0]!.startsWith('offer_yes:') &&
    payloads[1]!.startsWith('offer_no:'),
  'botões Aceito / Não posso com o id da oferta',
  payloads,
)

H.wa.sent.length = 0
await metaSends([waQuick(RENATO, payloads[0]!)])
check(
  await until(async () => (await db.select().from(schema.contacts))[0]?.status === 'active'),
  'toque no botão do modelo vira aceite e o contato fica ativo',
)
check(
  H.wa.sent.some((p) => (p as { to: string }).to === RENATO.replace('+', '')),
  'o contato recebe a confirmação (janela aberta pela resposta dele)',
)
check(
  (await db.select().from(schema.assignments))[0]?.status === 'accepted',
  'oferta aceita no banco',
)

// ================================================================ 7) lembretes
section('7) lembrete por iniciativa do Pingo (janela de 24 h fechada)')
H.clock.now = new Date('2026-11-11T20:30:00-03:00') // véspera, 20:30; ninguém escreve há dias
H.wa.sent.length = 0
const fired = await orch.tickReminders()
check(fired >= 1, 'lembrete disparado', fired)
await until(() => H.wa.sent.length >= 2)
const ownerRem = H.wa.sent.find((p) => (p as { to: string }).to === OWNER.replace('+', '')) as {
  type: string
  template: {
    name: string
    components: { type: string; parameters: { text?: string; payload?: string }[] }[]
  }
}
check(
  ownerRem?.type === 'template' && ownerRem.template.name === 'lembrete_item',
  'dono: vai como modelo lembrete_item',
)
const remPayloads = ownerRem.template.components
  .filter((c) => c.type === 'button')
  .map((c) => c.parameters[0]!.payload!)
check(
  remPayloads.length === 3 &&
    remPayloads[0]!.startsWith('rem_done:') &&
    remPayloads[1]!.startsWith('rem_snooze1h:'),
  'com os 3 botões: Feito, Adiar 1 h, Amanhã 9h',
  remPayloads,
)
const contactRem = H.wa.sent.find((p) => (p as { to: string }).to === RENATO.replace('+', '')) as
  { type: string; template: { name: string } } | undefined
check(
  contactRem?.type === 'template' && contactRem.template.name === 'lembrete_contato',
  'contato: modelo lembrete_contato',
)
// O dono toca em "Feito" no modelo → resposta rápida chega como botão.
H.wa.sent.length = 0
await metaSends([waQuick(OWNER, remPayloads[0]!)])
check(
  await until(
    async () =>
      (await db.select().from(schema.items).where(eq(schema.items.id, dentist.id)).get())
        ?.status === 'done',
  ),
  'Feito pelo botão do modelo conclui o item',
)

section('8) falha de envio ao contato não repete o aviso do dono')
const meet = (await db.select().from(schema.items)).find((i) => i.title === 'Reunião')!
await db
  .update(schema.items)
  .set({ assigneeContactId: contactRow.id })
  .where(eq(schema.items.id, meet.id))
await db.insert(schema.assignments).values({
  id: 'a-meet',
  itemId: meet.id,
  contactId: contactRow.id,
  status: 'accepted',
  offeredAt: H.clock.now.toISOString(),
})
await db
  .insert(schema.reminders)
  .values({ id: 'rem-meet', itemId: meet.id, remindAt: H.clock.now.toISOString() })
await db.update(schema.items).set({ status: 'confirmed' }).where(eq(schema.items.id, meet.id))
H.wa.sent.length = 0
const realSend = H.wa.send.bind(H.wa)
H.wa.send = async (p) => {
  if ((p as { to: string }).to === RENATO.replace('+', ''))
    throw new WaError(500, undefined, 'Meta fora do ar')
  return realSend(p)
}
await orch.tickReminders()
await until(() => H.wa.sent.length >= 1)
await orch.tickReminders()
await wait(100)
check(
  H.wa.sent.filter((p) => (p as { to: string }).to === OWNER.replace('+', '')).length === 1,
  'o dono recebeu o lembrete uma única vez',
)
check(
  (await db.select().from(schema.reminders).where(eq(schema.reminders.id, 'rem-meet')).get())
    ?.status === 'sent',
  'lembrete marcado como enviado',
)
H.wa.send = realSend

// ============================================================== 9) rede e falhas
section('9) relay fora do ar e volta; mensagem não se perde')
statuses.length = 0
relayDown = true
check(await until(() => relay.status === 'offline'), 'sem rede: status offline')
await metaSends([waText(OWNER, 'hoje')]) // chega ao relay (fila) enquanto o app não alcança
H.wa.sent.length = 0
relayDown = false
check(await until(() => relay.status === 'online'), 'rede volta: status online de novo')
check(await until(() => H.wa.sent.length >= 1), 'a mensagem que esperou na fila foi tratada depois')

section('10) fila e ack: o que deu errado no app não fica preso')
const failing = new RelayChannel({
  baseUrl: BASE,
  getToken: async () => token,
  fetchFn: fakeFetch,
  pollWaitSec: 0,
  idleDelayMs: 5,
  sleep: (ms) => wait(Math.min(ms, 20)),
})
// Um segundo leitor da mesma fila só para provar que o ack acontece mesmo quando o tratamento falha.
await orch.stop()
failing.onEvent(() => {
  throw new Error('explodiu')
})
await metaSends([waText(OWNER, 'mensagem que faz o tratamento falhar')])
await failing.start()
check(
  await until(() => H.queue.all.length === 0),
  'mesmo com erro no tratamento, a mensagem é confirmada (reentregar só duplicaria)',
)
await failing.stop()

// ================================================================ 11) conversões
section('11) conversão para os limites do WhatsApp')
const long = Array.from({ length: 200 }, (_, i) => `Linha ${i} com algum texto para encher`).join(
  '\n',
)
check(
  splitText(long).every((p) => p.length <= 4000) && splitText(long).length >= 2,
  'texto de mais de 4096 caracteres é dividido',
)
check(
  splitText(long).join('\n').replace(/\s+/g, ' ').length >= long.replace(/\s+/g, ' ').length - 5,
  'sem perder conteúdo',
)
const rows = Array.from({ length: 10 }, (_, i) => ({
  id: `item:${i}`,
  title: `Um título bem comprido número ${i}`,
  description: 'd'.repeat(100),
}))
const lw = toWire({
  type: 'list',
  text: 'Escolha',
  buttonLabel: 'Abrir um item com rótulo longo demais',
  rows,
})
const lp = lw.parts[0] as { buttonLabel: string; rows: { title: string; description?: string }[] }
check(
  lp.buttonLabel.length <= 20 &&
    lp.rows.every((r) => r.title.length <= 24 && (r.description?.length ?? 0) <= 72),
  'lista: título, descrição e rótulo cortados nos limites',
)
const bw = toWire({ type: 'buttons', text: 'x'.repeat(1500), buttons: [{ id: 'a', title: 'Sim' }] })
check(
  bw.parts.length >= 2 && (bw.parts.at(-1) as { type: string }).type === 'buttons',
  'botões com corpo grande: texto inteiro e botões logo depois',
)
const card = renderCardText({
  itemId: 'i',
  kind: 'event',
  title: 'T'.repeat(500),
  summary: 'S'.repeat(900),
  fields: [{ key: 'when', label: 'Quando', value: null }],
  actions: [],
})
check(card.length <= 1024, 'texto do cartão cabe no corpo de 1024')
check(
  renderCardText({
    itemId: 'i',
    kind: 'event',
    title: 'A',
    fields: [{ key: 'when', label: 'Quando', value: null }],
    actions: [],
  }).includes('não informado'),
  'campo vazio aparece como "não informado"',
)

// ============================================================== 12) MultiChannel
section('12) conversa do app + WhatsApp (MultiChannel)')
const local = new MemoryChannel()
const remote = new MemoryChannel()
const mirrored: string[] = []
const multi = new MultiChannel(local, remote, {
  ownerPhone: OWNER,
  mirrorIncoming: (e) => mirrored.push(e.channelMsgId),
})
const got: string[] = []
multi.onEvent((e) => void got.push(`${e.channel}:${e.channelMsgId}`))
await multi.start()
await remote.emit({
  type: 'message',
  channel: 'whatsapp',
  channelMsgId: 'w1',
  fromPhone: OWNER,
  receivedAt: '',
  text: 'oi',
})
await multi.send(OWNER, { type: 'text', text: 'resposta' })
check(
  local.sent.length === 1 && remote.sent.length === 1,
  'veio do WhatsApp: a resposta vai ao app e ao WhatsApp',
)
check(
  mirrored.length === 1 && got.length === 1,
  'e a mensagem do WhatsApp é espelhada na conversa do app',
)
await local.emit({
  type: 'message',
  channel: 'simulator',
  channelMsgId: 's1',
  fromPhone: OWNER,
  receivedAt: '',
  text: 'oi',
})
local.drain()
remote.drain()
await multi.send(OWNER, { type: 'text', text: 'resposta ao app' })
check(local.sent.length === 1 && remote.sent.length === 0, 'veio do app: a resposta fica só no app')
await multi.send(OWNER, {
  type: 'text',
  text: '🔔 lembrete',
  fallback: { type: 'template', name: 'lembrete_item', variables: ['a', 'b'] },
})
check(
  remote.sent.length === 1,
  'aviso por iniciativa do Pingo (com modelo de reserva) vai também ao WhatsApp',
)
remote.drain()
await multi.send(RENATO, { type: 'text', text: 'oi contato' })
check(
  remote.sent.length === 1 && local.sent.filter((s) => s.toPhone === RENATO).length === 0,
  'contato: só WhatsApp',
)
const failingRemote = new MemoryChannel()
failingRemote.send = async () => {
  throw new Error('sem rede')
}
const multi2 = new MultiChannel(new MemoryChannel(), failingRemote, { ownerPhone: OWNER })
let threw = false
try {
  await multi2.send(OWNER, {
    type: 'text',
    text: 'x',
    fallback: { type: 'template', name: 'lembrete_item', variables: [] },
  })
} catch {
  threw = true
}
check(!threw, 'falha do WhatsApp não derruba o que já apareceu no app')

// ============================================================ 13) apagar e revogar
section('13) apagar na nuvem e perder o acesso')
await relay.eraseRemote()
check(H.db.items.size === 0, 'DELETE /me esvazia o relay')
const probe = new RelayChannel({
  baseUrl: BASE,
  getToken: async () => token,
  fetchFn: fakeFetch,
  pollWaitSec: 0,
  idleDelayMs: 5,
  sleep: (ms) => wait(Math.min(ms, 20)),
})
await probe.start()
check(
  await until(() => probe.status === 'unauthorized'),
  'token revogado: o canal avisa "unauthorized" e para de insistir',
)
await probe.stop()
const noToken = new RelayChannel({
  baseUrl: BASE,
  getToken: async () => null,
  fetchFn: fakeFetch,
  pollWaitSec: 0,
  idleDelayMs: 5,
})
await noToken.start()
check(
  await until(() => noToken.status === 'unauthorized'),
  'sem token (não pareado): "unauthorized"',
)
await noToken.stop()
let sendErr: unknown
try {
  await noToken.send(OWNER, { type: 'text', text: 'x' })
} catch (e) {
  sendErr = e
}
check(sendErr instanceof RelayError && sendErr.status === 401, 'enviar sem parear dá erro claro')

console.log(fails === 0 ? '\n✅ Canal WhatsApp ok.' : `\n❌ ${fails} verificação(ões) falharam.`)
process.exit(fails === 0 ? 0 : 1)
