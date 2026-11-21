// Teste local do relay: handlers com AWS e Meta de mentirinha (em memória). Sem rede, sem custo.
// Uso: pnpm --filter @pingo/relay test
import type { IncomingEvent } from '@pingo/shared'
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
  sendReminder,
} from '../src/handlers/device'
import { OFFLINE_TEXT, signatureOf, webhook } from '../src/handlers/webhook'
import { guard, sha256Hex, type HttpEvent, type HttpResult } from '../src/http'
import { canonicalPhone, fromWaId } from '../src/phone'
import { WaError } from '../src/ports'
import { makeHarness } from '../src/testing/memory'
import { createWaClient, isMetaMediaUrl } from '../src/wa/client'
import { parseWebhook } from '../src/wa/inbound'
import { cleanTemplateParam, toWaPayload } from '../src/wa/outbound'

let fails = 0
const check = (ok: boolean, what: string, extra?: unknown) => {
  console.log(
    `  ${ok ? '✅' : '❌'} ${what}${!ok && extra !== undefined ? `\n      ↳ ${JSON.stringify(extra)}` : ''}`,
  )
  if (!ok) fails++
}
const section = (s: string) => console.log(`\n--- ${s}`)

const OWNER = '+5511988887777'
const CONTACT = '+5511977776666'
const STRANGER = '+5521955554444'
const SECRET = 'segredo-de-teste-do-app'

// ------------------------------------------------------------------ utilitários
type Req = {
  query?: Record<string, string>
  params?: Record<string, string>
  body?: unknown
  token?: string
  headers?: Record<string, string>
  method?: string
}
const ev = (r: Req): HttpEvent & { requestContext: { http: { method: string } } } => ({
  headers: {
    ...(r.token ? { authorization: `Bearer ${r.token}` } : {}),
    ...(r.headers ?? {}),
  },
  queryStringParameters: r.query,
  pathParameters: r.params,
  body:
    r.body === undefined ? undefined : typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
  isBase64Encoded: false,
  requestContext: { http: { method: r.method ?? 'POST' } },
})
const parse = (r: HttpResult) => (r.body ? JSON.parse(r.body as string) : {})

function waText(id: string, from: string, body: string, ts = 1794182400) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id,
                  from: from.replace('+', ''),
                  timestamp: String(ts),
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}
const withMessages = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] })

// =================================================================== telefones
section('1) telefones')
check(canonicalPhone('+554188887777') === '+5541988887777', 'celular BR sem o 9 ganha o 9')
check(canonicalPhone('+5541988887777') === '+5541988887777', 'com o 9 não muda')
check(canonicalPhone('+551133334444') === '+551133334444', 'telefone fixo não muda')
check(canonicalPhone('+14155550123') === '+14155550123', 'número de outro país não muda')
check(fromWaId('554188887777') === '+5541988887777', 'id da Meta vira E.164 canônico')

// ============================================================ mensagens de saída
section('2) conversão para a API da Meta')
const to = OWNER
check(
  (toWaPayload(to, { type: 'text', text: 'oi' }) as { to: string }).to === '5511988887777',
  'número vai só com dígitos',
)
const btn = toWaPayload(to, {
  type: 'buttons',
  text: 'Confirma?',
  buttons: [
    { id: 'confirm:1', title: 'Confirmar' },
    { id: 'discard:1', title: 'Descartar' },
  ],
}) as { interactive: { action: { buttons: { reply: { id: string } }[] } } }
check(btn.interactive.action.buttons[0]!.reply.id === 'confirm:1', 'botões de resposta')
const throws = (fn: () => unknown) => {
  try {
    fn()
    return false
  } catch {
    return true
  }
}
check(
  throws(() =>
    toWaPayload(to, {
      type: 'buttons',
      text: 'x',
      buttons: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: 'T' })),
    }),
  ),
  'recusa 4 botões',
)
check(
  throws(() =>
    toWaPayload(to, { type: 'buttons', text: 'x', buttons: [{ id: 'a', title: 'x'.repeat(21) }] }),
  ),
  'recusa título de botão com 21 caracteres',
)
check(
  throws(() =>
    toWaPayload(to, {
      type: 'list',
      text: 'x',
      buttonLabel: 'Abrir',
      rows: Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: 'L' })),
    }),
  ),
  'recusa lista com 11 linhas',
)
check(
  throws(() => toWaPayload(to, { type: 'text', text: 'a'.repeat(4097) })),
  'recusa texto acima de 4096',
)
check(
  throws(() => toWaPayload(to, { type: 'card' } as never)),
  'recusa cartão (o app converte antes)',
)
const tpl = toWaPayload(to, {
  type: 'template',
  name: 'lembrete_item',
  variables: ['Dentista\nquinta', 'amanhã   às 15h'],
  buttonPayloads: ['rem_done:abc'],
}) as {
  template: { components: { type: string; parameters: { text?: string; payload?: string }[] }[] }
}
check(
  tpl.template.components[0]!.parameters[0]!.text === 'Dentista · quinta' &&
    tpl.template.components[0]!.parameters[1]!.text === 'amanhã às 15h',
  'variáveis do modelo sem quebra de linha nem espaços repetidos',
)
check(
  tpl.template.components[1]!.parameters[0]!.payload === 'rem_done:abc',
  'payload do botão do modelo',
)
check(cleanTemplateParam('a\n\nb') === 'a · b', 'limpeza de variável')
check(
  throws(() => toWaPayload(to, { type: 'template', name: 'inventado' as never, variables: [] })),
  'recusa modelo desconhecido',
)

// ============================================================= mensagens de entrada
section('3) leitura do webhook da Meta')
const parsed = parseWebhook(
  withMessages([
    { id: 'w1', from: '554188887777', timestamp: '1794182400', type: 'text', text: { body: 'oi' } },
    {
      id: 'w2',
      from: '5511988887777',
      timestamp: '1794182400',
      type: 'image',
      image: { id: '111111', mime_type: 'image/jpeg', caption: 'olha' },
    },
    {
      id: 'w3',
      from: '5511988887777',
      timestamp: '1794182400',
      type: 'document',
      document: { id: '222222', mime_type: 'application/pdf' },
    },
    {
      id: 'w4',
      from: '5511988887777',
      timestamp: '1794182400',
      type: 'document',
      document: { id: '333333', mime_type: 'application/msword' },
    },
    {
      id: 'w5',
      from: '5511988887777',
      timestamp: '1794182400',
      type: 'audio',
      audio: { id: '444444', mime_type: 'audio/ogg; codecs=opus' },
    },
    {
      id: 'w6',
      from: '5511988887777',
      timestamp: '1794182400',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'confirm:9', title: 'Confirmar' } },
    },
    {
      id: 'w7',
      from: '5511988887777',
      timestamp: '1794182400',
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'item:7', title: 'x' } },
    },
    {
      id: 'w8',
      from: '5511977776666',
      timestamp: '1794182400',
      type: 'button',
      button: { payload: 'offer_yes:55', text: 'Aceito' },
    },
    { id: 'w9', from: '5511988887777', timestamp: '1794182400', type: 'reaction' },
    { id: 'w10', from: '5511988887777', timestamp: '1794182400', type: 'video' },
  ]),
)
const byId = (id: string) => parsed.find((p) => p.channelMsgId === id)
check(parsed.length === 9, 'reação é ignorada, o resto vira evento', parsed.length)
check(byId('w1')?.fromPhone === '+5541988887777', 'número sem o 9 foi normalizado')
check(byId('w1')?.channel === 'whatsapp', 'canal whatsapp')
check(!!byId('w1')?.receivedAt?.startsWith('2026-'), 'timestamp vira ISO')
check(
  byId('w2')?.type === 'message' &&
    (byId('w2') as { media?: { kind: string; ref: string }; text?: string }).media?.ref ===
      '111111' &&
    (byId('w2') as { text?: string }).text === 'olha',
  'imagem com legenda',
)
check((byId('w3') as { media?: { kind: string } }).media?.kind === 'pdf', 'PDF reconhecido')
check(
  (byId('w4') as { unsupportedType?: string }).unsupportedType === 'document',
  'outro documento é "não suportado"',
)
check((byId('w5') as { media?: { kind: string } }).media?.kind === 'audio', 'áudio')
check((byId('w6') as { buttonId?: string }).buttonId === 'confirm:9', 'toque em botão')
check((byId('w7') as { buttonId?: string }).buttonId === 'item:7', 'escolha em lista')
check(
  (byId('w8') as { buttonId?: string }).buttonId === 'offer_yes:55',
  'resposta rápida de modelo',
)
check(
  (byId('w10') as { unsupportedType?: string }).unsupportedType === 'video',
  'vídeo é "não suportado"',
)
check(
  parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'x' }] } }] }] }).length === 0,
  'só status: nada a fazer',
)
check(parseWebhook(null).length === 0 && parseWebhook({}).length === 0, 'payload vazio não quebra')

// ===================================================================== webhook
section('4) webhook: verificação e assinatura')
const H = makeHarness()
const hook = guard(() => H.deps, webhook)
const signed = (body: unknown, secret = SECRET): Req => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return { body: raw, headers: { 'x-hub-signature-256': signatureOf(secret, Buffer.from(raw)) } }
}
let r = await hook(
  ev({
    method: 'GET',
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'token-de-verificacao',
      'hub.challenge': '12345',
    },
  }),
)
check(r.statusCode === 200 && r.body === '12345', 'GET de verificação devolve o desafio')
r = await hook(
  ev({
    method: 'GET',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '1' },
  }),
)
check(r.statusCode === 403, 'token de verificação errado → 403')
r = await hook(ev({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.challenge': '1' } }))
check(r.statusCode === 403, 'sem token → 403')

await H.db.put({ pk: 'ALLOW', sk: OWNER, role: 'owner' })
await H.db.put({ pk: 'ALLOW', sk: CONTACT, role: 'contact' })
const body1 = waText('wamid.AAA', OWNER, 'Reunião sexta 15h')

r = await hook(ev({ body: JSON.stringify(body1) }))
check(r.statusCode === 401 && H.queue.all.length === 0, 'sem assinatura → 401 e nada na fila')
r = await hook(ev({ ...signed(body1, 'outro-segredo') }))
check(r.statusCode === 401 && H.queue.all.length === 0, 'assinatura de outro segredo → 401')
r = await hook(
  ev({ body: JSON.stringify(body1), headers: { 'x-hub-signature-256': 'sha256=zzzz' } }),
)
check(r.statusCode === 401, 'assinatura mal formada → 401')
const tampered = signed(body1)
r = await hook(ev({ ...tampered, body: (tampered.body as string).replace('Reunião', 'Reuniao') }))
check(r.statusCode === 401 && H.queue.all.length === 0, 'corpo alterado depois de assinado → 401')

r = await hook(ev(signed(body1)))
check(
  r.statusCode === 200 && H.queue.all.length === 1,
  'assinatura válida → 200 e 1 mensagem na fila',
)
const q0 = JSON.parse(H.queue.all[0]!.body) as IncomingEvent
check(
  q0.fromPhone === OWNER && q0.channelMsgId === 'wamid.AAA' && q0.channel === 'whatsapp',
  'evento correto na fila',
)
r = await hook(ev(signed(body1)))
check(
  r.statusCode === 200 && H.queue.all.length === 1,
  'mesma mensagem de novo → 200 e não duplica (R1.4)',
)

const rawB64 = JSON.stringify(waText('wamid.B64', OWNER, 'base64 ✓'))
r = await hook({
  ...ev({ headers: { 'x-hub-signature-256': signatureOf(SECRET, Buffer.from(rawB64)) } }),
  body: Buffer.from(rawB64).toString('base64'),
  isBase64Encoded: true,
})
check(
  r.statusCode === 200 && H.queue.all.length === 2,
  'corpo em base64 é assinado sobre os bytes certos',
)

r = await hook(ev(signed(waText('wamid.STR', STRANGER, 'oi, tudo bem?'))))
check(
  r.statusCode === 200 && H.queue.all.length === 2,
  'número fora da lista: 200, ignorado, nada na fila',
)
check(H.db.count('IDEMP') === 2 && H.db.count('WINDOW') === 1, 'e nada guardado sobre ele')
r = await hook(ev(signed('{não é json')))
check(r.statusCode === 400, 'assinatura ok mas JSON inválido → 400')
r = await hook(
  ev(signed({ entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'read' }] } }] }] })),
)
check(r.statusCode === 200 && H.queue.all.length === 2, 'só status de leitura → 200')
r = await hook(
  ev({ body: 'x'.repeat(300 * 1024), headers: { 'x-hub-signature-256': 'sha256=00' } }),
)
check(r.statusCode === 413, 'corpo grande demais → 413')

const noSecret = makeHarness()
noSecret.secrets.values['app-secret'] = undefined
r = await guard(() => noSecret.deps, webhook)(ev(signed(body1)))
check(
  r.statusCode === 503 && noSecret.queue.all.length === 0,
  'sem segredo configurado: falha fechada (503)',
)

H.db.items.delete(`WINDOW\u0000${OWNER}`)
const w = await H.db.get('WINDOW', CONTACT)
check(!w, 'janela de 24 h só existe para quem escreveu')

// ============================================================= aviso offline
section('5) "Recebi!" com o app offline (R9.4)')
const O = makeHarness()
const oh = guard(() => O.deps, webhook)
await O.db.put({ pk: 'ALLOW', sk: OWNER, role: 'owner' })
await O.db.put({ pk: 'ALLOW', sk: CONTACT, role: 'contact' })
await oh(ev(signed(waText('o1', OWNER, 'a'))))
check(
  O.wa.sent.length === 1 && JSON.stringify(O.wa.sent[0]).includes(OFFLINE_TEXT),
  'app nunca visto: responde "Recebi!"',
)
await oh(ev(signed(waText('o2', OWNER, 'b'))))
check(O.wa.sent.length === 1, 'segunda mensagem em 10 min: não repete')
O.clock.now = new Date(O.clock.now.getTime() + 11 * 60_000)
await oh(ev(signed(waText('o3', OWNER, 'c'))))
check(O.wa.sent.length === 2, 'depois de 10 min: avisa de novo')
O.clock.now = new Date(O.clock.now.getTime() + 11 * 60_000)
await O.db.put({
  pk: 'DEVICE',
  sk: 'main',
  tokenHash: 'x',
  lastSeenMs: O.clock.now.getTime() - 20_000,
})
await oh(ev(signed(waText('o4', OWNER, 'd'))))
check(O.wa.sent.length === 2, 'app online (visto há 20 s): não avisa')
await O.db.update('DEVICE', 'main', { lastSeenMs: O.clock.now.getTime() - 200_000 })
await oh(ev(signed(waText('o5', OWNER, 'e'))))
check(O.wa.sent.length === 3, 'app visto há 200 s: conta como offline')
O.clock.now = new Date(O.clock.now.getTime() + 11 * 60_000)
await oh(ev(signed(waText('o6', CONTACT, 'f'))))
check(
  O.wa.sent.length === 3 && O.queue.all.length === 6,
  'mensagem de contato: entra na fila, sem aviso',
)
O.clock.now = new Date(O.clock.now.getTime() + 11 * 60_000)
O.wa.failWith = new WaError(500, undefined, 'Meta fora do ar')
r = await oh(ev(signed(waText('o7', OWNER, 'g'))))
check(
  r.statusCode === 200 && O.queue.all.some((m) => m.dedup === 'o7'),
  'Meta falha no aviso: mensagem continua na fila e responde 200',
)
O.wa.failWith = null

// ================================================================= pareamento
section('6) pareamento e autenticação')
const D = makeHarness()
const P = {
  pair: guard(() => D.deps, pair),
  inbox: guard(() => D.deps, inbox),
  ack: guard(() => D.deps, ack),
  outbox: guard(() => D.deps, outbox),
  media: guard(() => D.deps, media),
  allowlist: guard(() => D.deps, allowlist),
  putReminder: guard(() => D.deps, putReminder),
  deleteReminder: guard(() => D.deps, deleteReminder),
  eraseMe: guard(() => D.deps, eraseMe),
}
const CODE = 'ABCD-EFGH-JKLM-NPQR-STUV'
const codeHash = sha256Hex(CODE.replace(/[\s-]/g, '').toUpperCase())
const putCode = (expiresInMs = 600_000) =>
  D.db.put({ pk: 'PAIR', sk: codeHash, expiresMs: D.clock.now.getTime() + expiresInMs })

r = await P.pair(ev({ body: { code: CODE } }))
check(r.statusCode === 401, 'código inexistente → 401')
r = await P.pair(ev({ body: { code: 'curto' } }))
check(r.statusCode === 401, 'código curto demais → 401')
r = await P.pair(ev({ body: 'não json' }))
check(r.statusCode === 400, 'corpo inválido → 400')
await putCode(-1000)
r = await P.pair(ev({ body: { code: CODE } }))
check(
  r.statusCode === 401 && !(await D.db.get('PAIR', codeHash)),
  'código vencido → 401 e é descartado',
)
await putCode()
r = await P.pair(ev({ body: { code: CODE.toLowerCase().replaceAll('-', ' ') } }))
const tok1 = parse(r).token as string
check(
  r.statusCode === 200 && typeof tok1 === 'string' && tok1.length >= 40,
  'código válido (maiúsculas/hífens tanto faz) → token',
)
const dev = await D.db.get('DEVICE', 'main')
check(
  dev?.tokenHash === sha256Hex(tok1) && !JSON.stringify(dev).includes(tok1),
  'só o hash do token é guardado',
)
r = await P.pair(ev({ body: { code: CODE } }))
check(r.statusCode === 401, 'código é de uso único')
await putCode()
const tok2 = parse(await P.pair(ev({ body: { code: CODE } }))).token as string
check(tok2 !== tok1, 'parear de novo gera outro token')
r = await P.inbox(ev({ token: tok1 }))
check(r.statusCode === 401, 'o token antigo foi revogado')

const routes: [string, (e: HttpEvent) => Promise<HttpResult>, Req][] = [
  ['inbox', P.inbox, {}],
  ['ack', P.ack, { body: { receipts: [] } }],
  ['outbox', P.outbox, { body: {} }],
  ['media', P.media, { params: { id: '123456' } }],
  ['allowlist', P.allowlist, { body: {} }],
  ['reminders PUT', P.putReminder, { params: { id: 'abcdefgh' }, body: {} }],
  ['reminders DELETE', P.deleteReminder, { params: { id: 'abcdefgh' } }],
  ['me', P.eraseMe, {}],
]
for (const [name, fn, req] of routes) {
  const a = await fn(ev(req))
  const b = await fn(ev({ ...req, token: 'token-que-nao-existe-de-jeito-nenhum' }))
  const c = await fn(ev({ ...req, headers: { authorization: 'Basic abc' } }))
  check(
    a.statusCode === 401 && b.statusCode === 401 && c.statusCode === 401,
    `${name}: sem token, token errado e esquema errado → 401`,
  )
}
const TOKEN = tok2

// ============================================================== lista permitida
section('7) lista de números permitidos')
r = await P.allowlist(
  ev({
    token: TOKEN,
    body: {
      owner: '+5541988887777',
      contacts: ['+554177776666', '+5511977776666', '+5541988887777'],
    },
  }),
)
check(
  r.statusCode === 200 && parse(r).contacts === 2,
  'dono + 2 contatos (duplicado e o próprio dono saem)',
  parse(r),
)
check(
  !!(await D.db.get('ALLOW', '+5541988887777')) &&
    (await D.db.get('ALLOW', '+5541988887777'))?.role === 'owner',
  'dono marcado como owner',
)
check(!!(await D.db.get('ALLOW', '+5541977776666')), 'contato sem o 9 foi normalizado')
await P.allowlist(ev({ token: TOKEN, body: { owner: OWNER, contacts: [CONTACT] } }))
check(
  (await D.db.query('ALLOW')).length === 2 && !(await D.db.get('ALLOW', '+5541988887777')),
  'a lista é substituída (quem saiu, sai)',
)
r = await P.allowlist(ev({ token: TOKEN, body: { owner: '123', contacts: [] } }))
check(r.statusCode === 400, 'telefone inválido → 400')
r = await P.allowlist(
  ev({
    token: TOKEN,
    body: {
      owner: OWNER,
      contacts: Array.from({ length: 51 }, (_, i) => `+55119000${String(i).padStart(5, '0')}`),
    },
  }),
)
check(r.statusCode === 400, 'mais de 50 contatos → 400')

// ================================================================ caixa de entrada
section('8) caixa de entrada (long polling) e confirmação')
const evt = (id: string, from = OWNER): IncomingEvent => ({
  type: 'message',
  channel: 'whatsapp',
  channelMsgId: id,
  fromPhone: from,
  receivedAt: D.clock.now.toISOString(),
  text: `texto ${id}`,
})
await D.queue.send(JSON.stringify(evt('q1')), 'q1', 'g1')
await D.queue.send(JSON.stringify(evt('q2', CONTACT)), 'q2', 'g2')
await D.queue.send('isto não é json', 'q3', 'g3')
r = await P.inbox(ev({ token: TOKEN, query: { wait: '20', max: '10' } }))
let msgs = parse(r).messages as { receipt: string; event: IncomingEvent }[]
check(
  r.statusCode === 200 && msgs.length === 2,
  'devolve as mensagens legíveis (a ilegível é pulada)',
  msgs.length,
)
check(msgs[0]!.event.channelMsgId === 'q1', 'com o evento original')
check(
  (await D.db.get('DEVICE', 'main'))!.lastSeenMs === D.clock.now.getTime(),
  'marca o app como visto agora',
)
r = await P.inbox(ev({ token: TOKEN }))
check(parse(r).messages.length === 0, 'mensagens em voo não voltam enquanto não vence o prazo')
r = await P.ack(ev({ token: TOKEN, body: { receipts: [msgs[0]!.receipt] } }))
check(parse(r).acked === 1, 'ack remove da fila')
D.clock.now = new Date(D.clock.now.getTime() + 121_000)
r = await P.inbox(ev({ token: TOKEN }))
msgs = parse(r).messages
check(
  msgs.length === 1 && msgs[0]!.event.channelMsgId === 'q2',
  'sem ack, volta depois do prazo (e o que teve ack, não)',
)
r = await P.ack(
  ev({ token: TOKEN, body: { receipts: Array.from({ length: 11 }, (_, i) => `r${i}`) } }),
)
check(r.statusCode === 400, 'ack com mais de 10 → 400')
r = await P.ack(ev({ token: TOKEN, body: { receipts: 'x' } }))
check(r.statusCode === 400, 'ack malformado → 400')

// ===================================================================== envio
section('9) envio (outbox) e janela de 24 h')
const text = { type: 'text' as const, text: 'Oi!' }
const offer = {
  type: 'template' as const,
  name: 'oferta_responsabilidade' as const,
  variables: ['Renato', 'Levar bolo'],
  buttonPayloads: ['offer_yes:1', 'offer_no:1'],
}
r = await P.outbox(ev({ token: TOKEN, body: { to: STRANGER, message: text } }))
check(
  r.statusCode === 403 && D.wa.sent.length === 0,
  'número fora da lista: 403 (o relay não é porta aberta)',
)
r = await P.outbox(ev({ token: TOKEN, body: { to: OWNER, message: text } }))
check(
  r.statusCode === 409 && parse(r).error === 'window_closed',
  'janela fechada e sem modelo de reserva → 409',
)
r = await P.outbox(ev({ token: TOKEN, body: { to: OWNER, message: text, fallback: offer } }))
check(
  r.statusCode === 200 && parse(r).via === 'template',
  'janela fechada com reserva → vai como modelo',
)
check((D.wa.sent[0] as { type: string }).type === 'template', 'o que saiu para a Meta é o modelo')
await D.db.put({ pk: 'WINDOW', sk: OWNER, lastInboundMs: D.clock.now.getTime() - 3_600_000 })
r = await P.outbox(ev({ token: TOKEN, body: { to: OWNER, message: text, fallback: offer } }))
check(
  r.statusCode === 200 &&
    parse(r).via === 'free' &&
    (D.wa.sent[1] as { type: string }).type === 'text',
  'janela aberta → mensagem livre',
)
await D.db.put({
  pk: 'WINDOW',
  sk: OWNER,
  lastInboundMs: D.clock.now.getTime() - (24 * 3600_000 - 60_000),
})
r = await P.outbox(ev({ token: TOKEN, body: { to: OWNER, message: text, fallback: offer } }))
check(parse(r).via === 'template', 'a 1 min de fechar já usa modelo (margem de segurança)')
r = await P.outbox(ev({ token: TOKEN, body: { to: CONTACT, message: offer } }))
check(r.statusCode === 200 && parse(r).via === 'template', 'modelo direto funciona sem janela')
r = await P.outbox(ev({ token: TOKEN, body: { to: OWNER, message: { type: 'card' } } }))
check(r.statusCode === 400, 'cartão é recusado (o app converte antes)')
r = await P.outbox(ev({ token: TOKEN, body: { to: 'abc', message: text } }))
check(r.statusCode === 400, 'destino inválido → 400')
await D.db.put({ pk: 'WINDOW', sk: OWNER, lastInboundMs: D.clock.now.getTime() })
D.wa.failWith = new WaError(400, 131047, 'Re-engagement message')
r = await P.outbox(ev({ token: TOKEN, body: { to: OWNER, message: text } }))
check(
  r.statusCode === 502 &&
    parse(r).error === 'whatsapp_error' &&
    parse(r).detail === 'meta_400_131047',
  'erro da Meta → 502 com o código',
)
D.wa.failWith = new WaError(503, undefined, 'credenciais')
r = await P.outbox(ev({ token: TOKEN, body: { to: OWNER, message: text } }))
check(r.statusCode === 503 && parse(r).error === 'not_configured', 'sem credenciais da Meta → 503')
D.wa.failWith = null

// ===================================================================== mídia
section('10) mídia temporária')
D.wa.media.set('555555', { data: new Uint8Array(2000), mimeType: 'image/png' })
D.wa.media.set('666666', { data: new Uint8Array(11 * 1024 * 1024), mimeType: 'application/pdf' })
r = await P.media(ev({ token: TOKEN, params: { id: '555555' } }))
check(
  r.statusCode === 200 &&
    parse(r).url.startsWith('https://files.test/media/555555') &&
    parse(r).expiresInSec === 300 &&
    parse(r).sizeBytes === 2000,
  'baixa, guarda e devolve link de 5 min',
)
check(D.files.objects.has('media/555555'), 'arquivo ficou no armazenamento temporário')
r = await P.media(ev({ token: TOKEN, params: { id: '666666' } }))
check(r.statusCode === 413, 'arquivo acima de 10 MB → 413')
r = await P.media(ev({ token: TOKEN, params: { id: '../../etc' } }))
check(r.statusCode === 400, 'id com caracteres perigosos → 400')
r = await P.media(ev({ token: TOKEN, params: { id: '777777' } }))
check(r.statusCode === 502, 'mídia inexistente na Meta → 502')

// ================================================================== lembretes
section('11) lembretes na nuvem')
const at = new Date(D.clock.now.getTime() + 3 * 3600_000).toISOString()
const rem = {
  at,
  to: OWNER,
  message: { type: 'text' as const, text: '🔔 Dentista às 15h' },
  fallback: {
    ...offer,
    name: 'lembrete_item' as const,
    variables: ['Dentista', 'hoje 15h'],
    buttonPayloads: ['rem_done:1'],
  },
}
r = await P.putReminder(ev({ token: TOKEN, params: { id: 'rem-0001-aaaa' }, body: rem }))
check(
  r.statusCode === 200 &&
    D.scheduler.schedules.get('rem-0001-aaaa') === at &&
    !!(await D.db.get('REMINDER', 'rem-0001-aaaa')),
  'cria o agendamento e o registro',
)
await P.putReminder(
  ev({
    token: TOKEN,
    params: { id: 'rem-0001-aaaa' },
    body: { ...rem, at: new Date(D.clock.now.getTime() + 7200_000).toISOString() },
  }),
)
check(D.scheduler.schedules.size === 1, 'repetir o id atualiza, não duplica')
const bad = async (b: unknown, id = 'rem-0002-bbbb') =>
  (await P.putReminder(ev({ token: TOKEN, params: { id }, body: b }))).statusCode
check(
  (await bad({ ...rem, at: new Date(D.clock.now.getTime() - 1000).toISOString() })) === 400,
  'horário no passado → 400',
)
check(
  (await bad({ ...rem, at: new Date(D.clock.now.getTime() + 500 * 86400_000).toISOString() })) ===
    400,
  'mais de 400 dias → 400',
)
check((await bad({ ...rem, at: 'ontem' })) === 400, 'horário inválido → 400')
check((await bad({ ...rem, to: STRANGER })) === 403, 'destino fora da lista → 403')
check(
  (await bad({ ...rem, message: { type: 'text', text: '' } })) === 400,
  'mensagem inválida é recusada na criação',
)
check((await bad(rem, 'x')) === 400, 'id curto demais → 400')
check(D.scheduler.schedules.size === 1, 'nenhum dos pedidos ruins criou agendamento')

// o Scheduler dispara
await D.db.put({ pk: 'WINDOW', sk: OWNER, lastInboundMs: 0 })
D.wa.sent.length = 0
await sendReminder(D.deps, { id: 'rem-0001-aaaa' })
check(
  D.wa.sent.length === 1 && (D.wa.sent[0] as { type: string }).type === 'template',
  'janela fechada: lembrete sai como modelo',
)
check(!(await D.db.get('REMINDER', 'rem-0001-aaaa')), 'e o registro é apagado depois de enviar')
await sendReminder(D.deps, { id: 'rem-0001-aaaa' })
check(D.wa.sent.length === 1, 'disparo repetido não envia de novo')
await P.putReminder(ev({ token: TOKEN, params: { id: 'rem-0003-cccc' }, body: rem }))
await D.db.put({ pk: 'WINDOW', sk: OWNER, lastInboundMs: D.clock.now.getTime() })
await sendReminder(D.deps, { id: 'rem-0003-cccc' })
check((D.wa.sent[1] as { type: string }).type === 'text', 'janela aberta: lembrete sai como texto')
await P.putReminder(ev({ token: TOKEN, params: { id: 'rem-0004-dddd' }, body: rem }))
D.wa.failWith = new WaError(500, undefined, 'x')
let threw = false
try {
  await sendReminder(D.deps, { id: 'rem-0004-dddd' })
} catch {
  threw = true
}
check(
  threw && !!(await D.db.get('REMINDER', 'rem-0004-dddd')),
  'falha no envio: lança erro (Scheduler tenta de novo) e guarda o registro',
)
D.wa.failWith = null
await D.db.put({ pk: 'WINDOW', sk: OWNER, lastInboundMs: 0 })
await P.putReminder(
  ev({ token: TOKEN, params: { id: 'rem-0005-eeee' }, body: { ...rem, fallback: undefined } }),
)
threw = false
try {
  await sendReminder(D.deps, { id: 'rem-0005-eeee' })
} catch {
  threw = true
}
check(
  threw,
  'janela fechada e sem modelo: falha visível (vai para a fila de falhas e dispara alarme)',
)

r = await P.deleteReminder(ev({ token: TOKEN, params: { id: 'rem-0004-dddd' } }))
check(
  r.statusCode === 200 &&
    !D.scheduler.schedules.has('rem-0004-dddd') &&
    !(await D.db.get('REMINDER', 'rem-0004-dddd')),
  'cancelar remove agendamento e registro',
)
r = await P.deleteReminder(ev({ token: TOKEN, params: { id: 'rem-nunca-existiu' } }))
check(r.statusCode === 200, 'cancelar o que não existe não dá erro')

// =================================================================== apagar tudo
section('12) apagar meus dados na nuvem')
await D.queue.send(JSON.stringify(evt('z1')), 'z1', 'g1')
await D.files.put('media/1', new Uint8Array(1), 'x/y')
r = await P.eraseMe(ev({ token: TOKEN }))
check(r.statusCode === 200 && parse(r).deleted > 0, 'responde com quantos registros apagou')
check(
  D.db.items.size === 0 &&
    D.queue.all.length === 0 &&
    D.files.objects.size === 0 &&
    D.scheduler.schedules.size === 0,
  'tabela, fila, mídia e agendamentos vazios',
)
r = await P.inbox(ev({ token: TOKEN }))
check(r.statusCode === 401, 'o token também deixa de valer (precisa parear de novo)')

// ===================================================================== cliente da Meta
section('13) cliente da Meta (com fetch falso)')
const calls: { url: string; init: RequestInit }[] = []
const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url: String(url), init })
  if (String(url).includes('/messages')) {
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] }), { status: 200 })
  }
  return new Response(JSON.stringify({ error: { code: 190, message: 'token inválido' } }), {
    status: 401,
  })
}) as unknown as typeof fetch
const client = createWaClient({ secrets: H.secrets, fetchFn: fakeFetch })
const sent = await client.send({ hello: 'world' })
check(sent.messageId === 'wamid.OK', 'envio devolve o id da mensagem')
check(
  calls[0]!.url === 'https://graph.facebook.com/v25.0/1234567890/messages',
  'URL com versão e id do número',
  calls[0]?.url,
)
check(
  (calls[0]!.init.headers as Record<string, string>).authorization === 'Bearer token-de-acesso',
  'token no cabeçalho Authorization',
)
let err: unknown
try {
  await client.getMedia('999999', 1000)
} catch (e) {
  err = e
}
check(
  err instanceof WaError && err.status === 401 && err.code === 190,
  'erro da Meta vira WaError com status e código',
)
check(
  isMetaMediaUrl('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1'),
  'host da Meta aceito',
)
check(
  !isMetaMediaUrl('https://evil.example.com/x') &&
    !isMetaMediaUrl('http://lookaside.fbsbx.com/x') &&
    !isMetaMediaUrl('https://fbsbx.com.evil.io/x'),
  'outros hosts, http e domínios disfarçados recusados',
)

// ===================================================================== logs
section('14) logs não vazam dados')
const everything = JSON.stringify([...H.logs, ...O.logs, ...D.logs])
const secretsAndData = [
  SECRET,
  'token-de-acesso',
  'token-de-verificacao',
  TOKEN,
  tok1,
  OWNER,
  CONTACT,
  STRANGER,
  'Reunião sexta',
  'texto q1',
  '5511988887777',
]
const leaked = secretsAndData.filter((s) => everything.includes(s))
check(
  leaked.length === 0,
  'nenhum log contém segredo, token, telefone completo ou texto de mensagem',
  leaked,
)
check(H.logs.length + O.logs.length + D.logs.length > 10, 'e os logs existem (não é teste vazio)')

console.log(fails === 0 ? '\n✅ Relay ok.' : `\n❌ ${fails} verificação(ões) falharam.`)
process.exit(fails === 0 ? 0 : 1)
