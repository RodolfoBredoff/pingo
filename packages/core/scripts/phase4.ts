// Verificação determinística da Fase 4 (sem IA, sem custo): backup, importação e apagar tudo.
// Uso: pnpm --filter @pingo/core phase4
import { eq } from 'drizzle-orm'
import {
  BackupInvalidError,
  MemoryChannel,
  Orchestrator,
  eraseAllData,
  exportBackup,
  importBackup,
  backupFileName,
  BACKUP_FILE_PATTERN,
  parseBackup,
  parseCommand,
  schema,
  serializeBackup,
  type Extractor,
} from '../src'
import { openNodeDb } from './lib/node-db'

const OWNER = '+5511999990000'
const tz = 'America/Sao_Paulo'
let now = new Date('2026-11-07T21:00:00-03:00')

const extractor: Extractor = {
  async extract() {
    return {
      extraction: {
        actionable: true,
        transcript: null,
        items: [
          {
            kind: 'event',
            title: 'Dentista',
            summary: null,
            start: '2026-11-12T15:00:00',
            end: null,
            all_day: false,
            due: null,
            location: 'Centro',
            assignee_hint: null,
            missing: [],
            confidence: 0.9,
            evidence: '',
          },
        ],
      },
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

const db = await openNodeDb()
const channel = new MemoryChannel()
let erased = 0
const orch = new Orchestrator({
  db,
  channel,
  extractor,
  owner: { phone: OWNER, name: 'Hellena', tz },
  budget: { dailyUsd: 100, monthlyUsd: 100 },
  clock: () => now,
  reminderIntervalMs: 0,
  onEraseRequested: async () => {
    erased++
    await eraseAllData(db)
  },
})
await orch.start()

let seq = 0
const say = (t: string) =>
  orch.handle({
    type: 'message',
    channel: 'simulator',
    channelMsgId: `m${++seq}`,
    fromPhone: OWNER,
    receivedAt: now.toISOString(),
    text: t,
  })
const press = (id: string) =>
  orch.handle({
    type: 'button',
    channel: 'simulator',
    channelMsgId: `b${++seq}`,
    fromPhone: OWNER,
    receivedAt: now.toISOString(),
    buttonId: id,
  })
const sentText = () =>
  channel
    .drain()
    .map((s) => JSON.stringify(s.message))
    .join('\n')

let fails = 0
const check = (ok: boolean, what: string, extra?: string) => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${!ok && extra ? `\n      ↳ ${extra}` : ''}`)
  if (!ok) fails++
}
const section = (s: string) => console.log(`\n--- ${s}`)

// ---------------------------------------------------------------- dados de exemplo
await db
  .insert(schema.owner)
  .values({ id: 1, phone: OWNER, name: 'Hellena', tz, consentAt: now.toISOString() })
await db.insert(schema.settings).values([
  { key: 'theme', value: 'dark' },
  { key: 'cap_daily_usd', value: '0.5' },
  { key: 'consent_version', value: '1' },
  { key: 'backup_dir', value: '/Users/x/Backups' },
])
await say('adiciona Renato 11 98888-7777')
await say('Dentista quinta às 15h')
const item = (await db.select().from(schema.items))[0]!
await press(`confirm:${item.id}`)
const contact = (await db.select().from(schema.contacts))[0]!
await press(`assign:${item.id}:${contact.id}`)
channel.drain()
await db
  .insert(schema.usage)
  .values({ id: 'u1', at: now.toISOString(), role: 'text', model: 'stub', costUsd: 0.0001 })
await db.insert(schema.chatLog).values({
  id: 'cl1',
  at: now.toISOString(),
  sender: 'agent',
  payload: { type: 'text', text: 'oi', nested: { a: [1, 2] } },
})

section('1) exportar')
const before = await exportBackup(db, now)
const n = (b: typeof before, t: keyof typeof before.tables) => b.tables[t].length
check(n(before, 'items') === 1 && n(before, 'contacts') === 1, 'item e contato exportados')
check(n(before, 'reminders') >= 1, 'lembretes exportados', String(n(before, 'reminders')))
check(n(before, 'assignments') === 1, 'oferta ao contato exportada')
check(n(before, 'messages') >= 3, 'mensagens exportadas')
check(
  before.tables.settings.every((s) => !String(s.key).startsWith('backup_')) &&
    before.tables.settings.length === 3,
  'ajustes locais da máquina (backup_*) ficam fora',
)
const text = serializeBackup(before)
check(
  !text.includes('sk-or-') && !/api[_-]?key/i.test(text),
  'o arquivo não contém chaves nem segredos',
)
check(
  backupFileName(new Date('2026-11-07T23:30:00-03:00'), tz) === 'pingo-backup-2026-11-07.json' &&
    BACKUP_FILE_PATTERN.test('pingo-backup-2026-11-07.json') &&
    !BACKUP_FILE_PATTERN.test('minha-foto.json'),
  'nome do arquivo usa a data local e o padrão é restrito',
)

section('2) validar arquivos ruins (nada muda no banco)')
const snapshot = serializeBackup(await exportBackup(db, now))
const bad = async (label: string, input: string) => {
  let msg = ''
  try {
    parseBackup(input)
  } catch (e) {
    msg = e instanceof BackupInvalidError ? e.message : `ERRO INESPERADO ${String(e)}`
  }
  check(msg !== '' && !msg.startsWith('ERRO'), `recusa: ${label}`, msg)
}
await bad('texto qualquer', 'isso não é json')
await bad('JSON de outro programa', JSON.stringify({ a: 1 }))
await bad('versão futura', JSON.stringify({ ...before, version: 99 }))
await bad(
  'campo obrigatório faltando',
  JSON.stringify({
    ...before,
    tables: { ...before.tables, contacts: [{ id: 'x', name: 'Sem telefone' }] },
  }),
)
await bad(
  'tipo errado',
  JSON.stringify({
    ...before,
    tables: {
      ...before.tables,
      usage: [{ id: 'u', at: 'x', role: 'text', model: 'm', costUsd: 'caro' }],
    },
  }),
)
await bad(
  'item apontando para contato inexistente',
  JSON.stringify({
    ...before,
    tables: {
      ...before.tables,
      items: before.tables.items.map((r) => ({ ...r, assigneeContactId: 'fantasma' })),
    },
  }),
)
check(serializeBackup(await exportBackup(db, now)) === snapshot, 'banco intacto depois das recusas')

section('3) importar em banco vazio e comparar')
const db2 = await openNodeDb()
const parsed = parseBackup(text)
const summary = await importBackup(db2, parsed)
check(summary.items === 1 && summary.contacts === 1, 'resumo da importação')
const after = await exportBackup(db2, now)
check(
  JSON.stringify(after.tables) === JSON.stringify(before.tables),
  'dados idênticos após o ciclo exportar → importar',
)
check(
  (await db2.select().from(schema.chatLog))[0]?.payload?.nested !== undefined,
  'JSON aninhado do histórico sobreviveu',
)
check(
  (await db2.select().from(schema.items))[0]?.allDay === false,
  'booleanos voltam como booleanos',
)

section('4) importar por cima de dados existentes (substitui, mantém backup_*)')
await db2.insert(schema.settings).values({ key: 'backup_dir', value: '/outra/pasta' })
await db2
  .insert(schema.contacts)
  .values({ id: 'extra', name: 'Extra', phone: '+5511900000000', status: 'pending' })
await importBackup(db2, parsed)
check(
  (await db2.select().from(schema.contacts)).every((c) => c.id !== 'extra'),
  'o que não estava no backup foi removido',
)
check(
  (await db2.select().from(schema.settings).where(eq(schema.settings.key, 'backup_dir')).get())
    ?.value === '/outra/pasta',
  'ajuste local backup_dir preservado',
)

section('5) falha no meio da importação desfaz tudo')
const poisoned = {
  ...parsed,
  tables: {
    ...parsed.tables,
    // Duas linhas com a mesma chave primária: passa na validação, falha no INSERT.
    usage: [
      { id: 'dup', at: 'x', role: 'text', model: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 },
      { id: 'dup', at: 'x', role: 'text', model: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 },
    ],
  },
}
const keep = serializeBackup(await exportBackup(db2, now))
let threw = false
try {
  await importBackup(db2, poisoned)
} catch {
  threw = true
}
check(threw, 'a importação defeituosa avisa o erro')
check(serializeBackup(await exportBackup(db2, now)) === keep, 'dados anteriores restaurados')

section('6) apagar meus dados pelo chat')
check(
  parseCommand('apagar meus dados')?.type === 'erase',
  'comando "apagar meus dados" reconhecido',
)
check(parseCommand('Excluir todos os meus dados')?.type === 'erase', 'variação reconhecida')
check(parseCommand('apagar reunião') === null, '"apagar reunião" não é o comando')
await say('apagar meus dados')
let sent = JSON.parse(`[${sentText().split('\n').join(',')}]`) as {
  text?: string
  buttons?: { id: string }[]
}[]
const yes = sent[0]?.buttons?.find((b) => b.id.startsWith('erase_yes:'))?.id
check(!!yes && !!sent[0]?.text?.includes('Não dá para desfazer'), 'pede confirmação com aviso')
check(
  erased === 0 && (await db.select().from(schema.items)).length === 1,
  'nada some antes de confirmar',
)
await press('erase_no')
check(erased === 0 && sentText().includes('não apaguei'), '"Não, manter" não apaga')

now = new Date(now.getTime() + 3 * 60_000)
await press(yes!)
check(erased === 0 && sentText().includes('venceu'), 'botão antigo (3 min) não apaga')
now = new Date(now.getTime() - 3 * 60_000)

await say('apagar meus dados')
sent = JSON.parse(`[${sentText().split('\n').join(',')}]`)
await press(sent[0]!.buttons!.find((b) => b.id.startsWith('erase_yes:'))!.id)
check(erased === 1, 'confirmando, o app é chamado para apagar')
const left = await Promise.all(
  (
    [
      schema.contacts,
      schema.messages,
      schema.items,
      schema.reminders,
      schema.assignments,
      schema.usage,
      schema.chatLog,
      schema.owner,
    ] as const
  ).map(async (t) => (await db.select().from(t)).length),
)
check(
  left.every((x) => x === 0),
  'todas as tabelas de dados ficaram vazias',
  left.join(','),
)
const keys = (await db.select().from(schema.settings)).map((s) => s.key).sort()
check(
  JSON.stringify(keys) === JSON.stringify(['cap_daily_usd', 'theme']),
  'só tema e tetos sobreviveram (sem consentimento nem pasta de backup)',
  keys.join(','),
)

section('7) sem o app, o comando só orienta')
const bare = new Orchestrator({
  db,
  channel,
  extractor,
  owner: { phone: OWNER, name: 'Hellena', tz },
  budget: { dailyUsd: 100, monthlyUsd: 100 },
  clock: () => now,
  reminderIntervalMs: 0,
})
channel.drain()
await bare.handle({
  type: 'message',
  channel: 'simulator',
  channelMsgId: 'bare1',
  fromPhone: OWNER,
  receivedAt: now.toISOString(),
  text: 'apagar meus dados',
})
check(sentText().includes('Ajustes'), 'orienta a usar Ajustes')

console.log(fails === 0 ? '\n✅ Fase 4 (core) ok.' : `\n❌ ${fails} verificação(ões) falharam.`)
process.exit(fails === 0 ? 0 : 1)
