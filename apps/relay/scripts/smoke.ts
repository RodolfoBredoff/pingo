// Teste de fumaça do relay JÁ IMPLANTADO na AWS, sem a Meta: chamadas simuladas de verdade pela internet.
// Uso: AWS_PROFILE=publishing pnpm relay:smoke [--wipe]
//
// ATENÇÃO: o teste pareia um dispositivo de teste, mexe na lista de números e termina com DELETE /me,
// que apaga TUDO do relay. Por isso ele se recusa a rodar se já houver um dispositivo pareado ou
// números cadastrados (uso real), a menos que você passe --wipe sabendo disso.
import { createHmac } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import {
  GetScheduleCommand,
  SchedulerClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler'
import {
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm'
import { randomBytes } from 'node:crypto'
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { ListQueuesCommand, PurgeQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import { ACCOUNT, assertAccount, stackOutputs } from './lib/aws'
import { hashCode, newPairCode } from './pair-code'

let fails = 0
const check = (ok: boolean, what: string, extra?: unknown) => {
  console.log(
    `  ${ok ? '✅' : '❌'} ${what}${!ok && extra !== undefined ? `\n      ↳ ${JSON.stringify(extra)}` : ''}`,
  )
  if (!ok) fails++
}
const section = (s: string) => console.log(`\n--- ${s}`)

await assertAccount()
console.log(`Conta ${ACCOUNT} confirmada.`)
const out = await stackOutputs()
const API = out.ApiUrl
const TABLE = out.TableName
if (!API || !TABLE) throw new Error('Stack PingoRelay não encontrada. Rode o deploy antes.')

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const ssm = new SSMClient({})
const sched = new SchedulerClient({})

// Proteção: não passar por cima de uso real.
const inUse = async () => {
  const q = async (pk: string) =>
    (
      await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'pk = :p',
          ExpressionAttributeValues: { ':p': pk },
          Limit: 1,
        }),
      )
    ).Count ?? 0
  return (await q('DEVICE')) + (await q('ALLOW'))
}
if ((await inUse()) > 0 && !process.argv.includes('--wipe')) {
  console.error(
    'O relay já tem dispositivo ou números cadastrados (uso real). Este teste apagaria tudo. Use --wipe só se tiver certeza.',
  )
  process.exit(2)
}

// Credenciais de TESTE só são criadas se ainda não existirem (nunca sobrescreve as reais).
async function param(name: string): Promise<string> {
  const Name = `/pingo/meta/${name}`
  try {
    return (await ssm.send(new GetParameterCommand({ Name, WithDecryption: true }))).Parameter!
      .Value!
  } catch (e) {
    if (!(e instanceof ParameterNotFound)) throw e
    const value = `teste-${randomBytes(18).toString('base64url')}`
    await ssm.send(
      new PutParameterCommand({
        Name,
        Value: value,
        Type: 'SecureString',
        Overwrite: false,
        Description: 'Pingo: valor de TESTE (troque pelo real da Meta)',
      }),
    )
    console.log(`  (criei ${Name} com valor de teste; troque com pnpm relay:set-secret ${name})`)
    return value
  }
}
const appSecret = await param('app-secret')
const verifyToken = await param('verify-token')
await param('access-token')
await param('phone-number-id')

const OWNER = '+5511900000001'
const STRANGER = '+5511900000002'
const sign = (raw: string) => 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex')
const j = async (res: Response) => ({ status: res.status, body: await res.text() })
const parse = (b: string) => (b ? JSON.parse(b) : {})
const stamp = Date.now()

function waText(id: string, from: string, text: string) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id,
                  from: from.replace('+', ''),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  })
}
const post = (raw: string, signature?: string) =>
  fetch(`${API}/wa/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'x-hub-signature-256': signature } : {}),
    },
    body: raw,
  })

section('1) webhook: verificação e assinatura')
let r = await j(
  await fetch(`${API}/wa/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=777`),
)
check(r.status === 403, 'token de verificação errado → 403', r)
r = await j(
  await fetch(
    `${API}/wa/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=777`,
  ),
)
check(r.status === 200 && r.body === '777', 'verificação correta devolve o desafio', r)
r = await j(await post(waText(`smoke-${stamp}-0`, OWNER, 'sem assinatura')))
check(r.status === 401, 'sem assinatura → 401', r)
r = await j(
  await post(waText(`smoke-${stamp}-0`, OWNER, 'assinatura errada'), 'sha256=' + '0'.repeat(64)),
)
check(r.status === 401, 'assinatura errada → 401', r)

section('2) pareamento')
const code = newPairCode()
await ddb.send(
  new PutCommand({
    TableName: TABLE,
    Item: {
      pk: 'PAIR',
      sk: hashCode(code),
      expiresMs: Date.now() + 600_000,
      ttl: Math.floor(Date.now() / 1000) + 4000,
    },
  }),
)
r = await j(
  await fetch(`${API}/device/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  }),
)
const token = parse(r.body).token as string
check(r.status === 200 && !!token, 'código válido devolve token', r.status)
r = await j(
  await fetch(`${API}/device/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  }),
)
check(r.status === 401, 'o mesmo código não vale duas vezes', r)
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
r = await j(
  await fetch(`${API}/inbox`, {
    headers: { authorization: 'Bearer token-invalido-token-invalido' },
  }),
)
check(r.status === 401, 'token inválido → 401', r)

section('3) lista de números e entrega pela fila')
r = await j(
  await fetch(`${API}/allowlist`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ owner: OWNER, contacts: [] }),
  }),
)
check(r.status === 200, 'lista atualizada', r)
const body = waText(`smoke-${stamp}-1`, OWNER, 'Reunião sexta às 15h')
r = await j(await post(body, sign(body)))
check(r.status === 200, 'webhook assinado → 200', r)
r = await j(await fetch(`${API}/inbox?wait=10&max=10`, { headers: auth }))
const msgs = parse(r.body).messages as {
  receipt: string
  event: { channelMsgId: string; fromPhone: string; text?: string }
}[]
check(
  r.status === 200 &&
    msgs?.length === 1 &&
    msgs[0]!.event.channelMsgId === `smoke-${stamp}-1` &&
    msgs[0]!.event.fromPhone === OWNER,
  'a mensagem chegou pela fila (long polling)',
  r,
)
check(msgs?.[0]?.event.text === 'Reunião sexta às 15h', 'com o texto intacto (acentos incluídos)')
await post(body, sign(body))
r = await j(await fetch(`${API}/inbox?wait=3`, { headers: auth }))
check(parse(r.body).messages?.length === 0, 'mensagem repetida não volta (idempotência)', r)
r = await j(
  await fetch(`${API}/inbox/ack`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ receipts: [msgs[0]!.receipt] }),
  }),
)
check(parse(r.body).acked === 1, 'ack confirma o recebimento', r)
const stranger = waText(`smoke-${stamp}-2`, STRANGER, 'oi')
r = await j(await post(stranger, sign(stranger)))
check(r.status === 200, 'número fora da lista: 200', r)
r = await j(await fetch(`${API}/inbox?wait=3`, { headers: auth }))
check(parse(r.body).messages?.length === 0, 'e nada entra na fila', r)

section('4) envio (a Meta vai recusar: as credenciais são de teste)')
r = await j(
  await fetch(`${API}/outbox`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ to: STRANGER, message: { type: 'text', text: 'oi' } }),
  }),
)
check(r.status === 403, 'número fora da lista → 403', r)
r = await j(
  await fetch(`${API}/outbox`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ to: OWNER, message: { type: 'text', text: 'oi' } }),
  }),
)
check(
  r.status === 502 || r.status === 503,
  'chega à Meta e é recusado (502) ou falta credencial (503)',
  r,
)
console.log(`      ↳ resposta: ${r.status} ${r.body}`)

section('5) lembretes na nuvem (EventBridge Scheduler)')
const id = `smoke-${stamp}`.slice(0, 40)
const at = new Date(Date.now() + 15 * 60_000).toISOString()
r = await j(
  await fetch(`${API}/reminders/${id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ at, to: OWNER, message: { type: 'text', text: 'teste' } }),
  }),
)
check(r.status === 200, 'lembrete criado', r)
try {
  const s = await sched.send(
    new GetScheduleCommand({ Name: `pingo-rem-${id}`, GroupName: 'pingo' }),
  )
  check(
    s.ScheduleExpression?.startsWith('at(') === true && s.ActionAfterCompletion === 'DELETE',
    'agendamento único existe e se apaga depois de rodar',
    s.ScheduleExpression,
  )
  check(
    !!s.Target?.DeadLetterConfig?.Arn && s.Target.RetryPolicy?.MaximumRetryAttempts === 3,
    'com tentativas e fila de falhas configuradas',
  )
} catch (e) {
  check(false, 'agendamento não encontrado', String(e))
}
r = await j(
  await fetch(`${API}/reminders/${id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      at: new Date(Date.now() - 60_000).toISOString(),
      to: OWNER,
      message: { type: 'text', text: 'x' },
    }),
  }),
)
check(r.status === 400, 'horário no passado → 400', r)
r = await j(await fetch(`${API}/reminders/${id}`, { method: 'DELETE', headers: auth }))
check(r.status === 200, 'lembrete cancelado', r)
try {
  await sched.send(new GetScheduleCommand({ Name: `pingo-rem-${id}`, GroupName: 'pingo' }))
  check(false, 'o agendamento ainda existe')
} catch (e) {
  check(e instanceof ResourceNotFoundException, 'agendamento removido')
}

if (process.argv.includes('--fire')) {
  section('5b) lembrete que realmente dispara (leva uns 2 minutos)')
  const fid = `fire-${stamp}`.slice(0, 40)
  const started = Date.now()
  r = await j(
    await fetch(`${API}/reminders/${fid}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({
        at: new Date(started + 70_000).toISOString(),
        to: OWNER,
        message: { type: 'text', text: 'disparo de teste' },
      }),
    }),
  )
  check(r.status === 200, 'lembrete para daqui a 70 s criado', r)
  const logs = new CloudWatchLogsClient({})
  const groups = await logs.send(
    new DescribeLogGroupsCommand({ logGroupNamePrefix: 'PingoRelay-SendReminderLogs' }),
  )
  const group = groups.logGroups?.[0]?.logGroupName
  let seen = ''
  for (let i = 0; i < 18 && !seen && group; i++) {
    await new Promise((res) => setTimeout(res, 10_000))
    const ev = await logs.send(
      new FilterLogEventsCommand({
        logGroupName: group,
        startTime: started,
        filterPattern: '"lembrete"',
      }),
    )
    seen = ev.events?.map((e) => e.message ?? '').find((m) => m.includes('lembrete')) ?? ''
  }
  check(!!group, 'grupo de logs do send-reminder encontrado')
  check(!!seen, 'o Scheduler acordou a Lambda send-reminder na hora marcada', group)
  console.log(`      ↳ log: ${seen.trim().slice(0, 200)}`)
  check(
    seen.includes('whatsapp_error') || seen.includes('enviado'),
    'e ela tentou entregar pela Meta (recusada, credenciais de teste)',
  )
  // Limpa a fila de falhas para não deixar o alarme armado por causa do teste.
  const sqs = new SQSClient({})
  const q = (
    await sqs.send(new ListQueuesCommand({ QueueNamePrefix: 'PingoRelay-ReminderFailures' }))
  ).QueueUrls?.[0]
  if (q) await sqs.send(new PurgeQueueCommand({ QueueUrl: q })).catch(() => undefined)
}

section('6) apagar tudo')
r = await j(await fetch(`${API}/me`, { method: 'DELETE', headers: auth }))
check(r.status === 200, 'DELETE /me → 200', r)
check((await inUse()) === 0, 'dispositivo e lista de números apagados')
r = await j(await fetch(`${API}/inbox`, { headers: auth }))
check(r.status === 401, 'o token deixou de valer', r)

console.log(
  fails === 0
    ? '\n✅ Relay na AWS respondeu como esperado.'
    : `\n❌ ${fails} verificação(ões) falharam.`,
)
process.exit(fails === 0 ? 0 : 1)
