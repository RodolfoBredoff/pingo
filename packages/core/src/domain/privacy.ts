import { getTableColumns, inArray, like, not } from 'drizzle-orm'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import type { PingoDb } from '../db/client'
import {
  assignments,
  chatLog,
  contacts,
  conversationState,
  items,
  messages,
  owner,
  reminders,
  settings,
  usage,
} from '../db/schema'

/**
 * Privacidade e backup (R7, R11.3).
 * Tudo aqui é independente de plataforma: lê e grava só no banco. Quem escolhe arquivo,
 * pasta ou cofre de segredos é o app.
 */

/** Versão do texto de consentimento. Mudou o texto? Suba o número e todos reaceitam. */
export const CONSENT_VERSION = '1'
export const CONSENT_SETTING = 'consent_version'

export const BACKUP_FORMAT = 'pingo-backup'
export const BACKUP_VERSION = 1

/** Ordem que respeita as chaves estrangeiras: quem é referenciado vem antes. */
const TABLES = [
  ['contacts', contacts],
  ['messages', messages],
  ['items', items],
  ['reminders', reminders],
  ['assignments', assignments],
  ['conversation_state', conversationState],
  ['usage', usage],
  ['chat_log', chatLog],
  ['owner', owner],
  ['settings', settings],
] as const satisfies readonly (readonly [string, AnySQLiteTable])[]

type TableName = (typeof TABLES)[number][0]
type Row = Record<string, unknown>

/** Ajustes sem dado pessoal que sobrevivem a "apagar meus dados". */
const KEEP_ON_ERASE = ['theme', 'reduce_motion', 'cap_daily_usd', 'cap_monthly_usd']
/** Ajustes ligados a esta máquina: ficam fora do backup e não são trocados na importação. */
const LOCAL_ONLY_PREFIX = 'backup_'

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  tables: Record<TableName, Row[]>
}

export class BackupInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupInvalidError'
  }
}

// ---------------------------------------------------------------------- apagar

/**
 * Apaga tudo que é do dono: itens, contatos, mensagens, conversa, histórico de gastos e cadastro.
 * Preserva só preferências visuais e tetos de gasto. Segredos (cofre) e nuvem são com o app.
 */
export async function eraseAllData(db: PingoDb): Promise<void> {
  await wipe(db, (t) =>
    t === settings ? db.delete(settings).where(not(inArray(settings.key, KEEP_ON_ERASE))) : null,
  )
}

/** Apaga as tabelas na ordem inversa das dependências. `custom` troca o DELETE de uma tabela. */
async function wipe(
  db: PingoDb,
  custom?: (table: AnySQLiteTable) => PromiseLike<unknown> | null,
): Promise<void> {
  for (const [, table] of [...TABLES].reverse()) {
    const special = custom?.(table)
    if (special) await special
    else await db.delete(table)
  }
}

// ---------------------------------------------------------------------- backup

export async function exportBackup(db: PingoDb, now: Date = new Date()): Promise<Backup> {
  const tables = {} as Record<TableName, Row[]>
  for (const [name, table] of TABLES) {
    const rows = (await db.select().from(table)) as Row[]
    tables[name] =
      name === 'settings' ? rows.filter((r) => !String(r.key).startsWith(LOCAL_ONLY_PREFIX)) : rows
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), tables }
}

export function serializeBackup(b: Backup): string {
  return JSON.stringify(b)
}

export function backupFileName(now: Date, tz: string): string {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return `pingo-backup-${d}.json`
}

export const BACKUP_FILE_PATTERN = /^pingo-backup-\d{4}-\d{2}-\d{2}\.json$/

/** Lê e valida o texto de um arquivo de backup. Não toca no banco. */
export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupInvalidError('O arquivo não é um backup do Pingo (não consegui ler).')
  }
  const b = raw as Partial<Backup> | null
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) {
    throw new BackupInvalidError('O arquivo não é um backup do Pingo.')
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupInvalidError(
      'Esse backup é de uma versão mais nova do Pingo. Atualize o app e tente de novo.',
    )
  }
  if (!b.tables || typeof b.tables !== 'object') {
    throw new BackupInvalidError('O backup está incompleto.')
  }

  const clean = {} as Record<TableName, Row[]>
  for (const [name, table] of TABLES) {
    const rows = (b.tables as Record<string, unknown>)[name]
    if (rows === undefined) {
      clean[name] = []
      continue
    }
    if (!Array.isArray(rows)) throw new BackupInvalidError(`Tabela "${name}" inválida no backup.`)
    clean[name] = rows.map((r, i) => validateRow(name, table, r, i))
  }
  checkReferences(clean)
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    exportedAt: String(b.exportedAt ?? ''),
    tables: clean,
  }
}

function validateRow(name: string, table: AnySQLiteTable, raw: unknown, index: number): Row {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BackupInvalidError(`Linha ${index + 1} de "${name}" inválida.`)
  }
  const src = raw as Row
  const out: Row = {}
  for (const [prop, col] of Object.entries(getTableColumns(table))) {
    const v = src[prop]
    if (v === undefined || v === null) {
      if (col.notNull && !col.hasDefault) {
        throw new BackupInvalidError(`Falta "${prop}" na linha ${index + 1} de "${name}".`)
      }
      if (v === null && !col.notNull) out[prop] = null
      continue
    }
    const ok =
      col.dataType === 'string'
        ? typeof v === 'string'
        : col.dataType === 'number'
          ? typeof v === 'number' && Number.isFinite(v)
          : col.dataType === 'boolean'
            ? typeof v === 'boolean'
            : col.dataType === 'json'
              ? typeof v === 'object'
              : false
    if (!ok)
      throw new BackupInvalidError(`Valor inesperado em "${name}.${prop}" (linha ${index + 1}).`)
    out[prop] = v
  }
  return out
}

function checkReferences(t: Record<TableName, Row[]>): void {
  const ids = (rows: Row[]) => new Set(rows.map((r) => r.id))
  const msgs = ids(t.messages)
  const cons = ids(t.contacts)
  const its = ids(t.items)
  const bad = (what: string) => new BackupInvalidError(`Backup inconsistente: ${what}.`)
  for (const r of t.items) {
    if (r.sourceMessageId != null && !msgs.has(r.sourceMessageId))
      throw bad('item sem a mensagem de origem')
    if (r.assigneeContactId != null && !cons.has(r.assigneeContactId))
      throw bad('item com contato inexistente')
  }
  for (const r of t.reminders) if (!its.has(r.itemId)) throw bad('lembrete sem item')
  for (const r of t.assignments) {
    if (!its.has(r.itemId) || !cons.has(r.contactId)) throw bad('oferta sem item ou contato')
  }
}

export interface ImportSummary {
  items: number
  contacts: number
  messages: number
}

/**
 * Troca TODOS os dados atuais pelos do backup. Valide antes com `parseBackup`.
 * O driver do app não oferece transação confiável, então guardamos uma cópia dos dados atuais na
 * memória e a restauramos se algo falhar no meio.
 */
export async function importBackup(db: PingoDb, backup: Backup): Promise<ImportSummary> {
  const previous = await exportBackup(db)
  try {
    await replaceAll(db, backup)
  } catch (e) {
    await replaceAll(db, previous)
    throw e
  }
  return {
    items: backup.tables.items.length,
    contacts: backup.tables.contacts.length,
    messages: backup.tables.messages.length,
  }
}

async function replaceAll(db: PingoDb, backup: Backup): Promise<void> {
  await wipe(db, (t) =>
    t === settings
      ? db.delete(settings).where(not(like(settings.key, `${LOCAL_ONLY_PREFIX}%`)))
      : null,
  )
  const CHUNK = 50
  for (const [name, table] of TABLES) {
    const rows = backup.tables[name] ?? []
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(table).values(rows.slice(i, i + CHUNK) as never)
    }
  }
}
