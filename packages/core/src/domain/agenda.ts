import { inArray, sql } from 'drizzle-orm'
import type { ListRow } from '@pingo/shared'
import type { PingoDb } from '../db/client'
import { items, type ItemStatus } from '../db/schema'
import { formatWhen, localDate, localTime } from '../time'
import { normalizeName } from './contacts-match'
import type { ItemRow } from './items'

/** Consultas e formatação de agenda (R4). */

const sortKey = sql`coalesce(${items.startsAt}, ${items.dueAt})`

export async function listItems(db: PingoDb, statuses: ItemStatus[]): Promise<ItemRow[]> {
  if (statuses.length === 0) return []
  return (
    db
      .select()
      .from(items)
      .where(inArray(items.status, statuses))
      // Itens sem data por último; os demais em ordem cronológica.
      .orderBy(sql`${sortKey} is null`, sortKey, items.createdAt)
  )
}

export async function itemStatuses(
  db: PingoDb,
  ids: string[],
): Promise<Record<string, ItemStatus>> {
  if (ids.length === 0) return {}
  const rows = await db
    .select({ id: items.id, status: items.status })
    .from(items)
    .where(inArray(items.id, ids))
  return Object.fromEntries(rows.map((r) => [r.id, r.status]))
}

export interface AgendaDay {
  /** "YYYY-MM-DD" local, ou null para itens sem data. */
  date: string | null
  items: ItemRow[]
}

/** Agrupa por dia local, mantendo a ordem recebida. */
export function groupByLocalDay(rows: ItemRow[], tz: string): AgendaDay[] {
  const days: AgendaDay[] = []
  for (const r of rows) {
    const ref = r.startsAt ?? r.dueAt
    const date = ref ? localDate(ref, tz) : null
    const last = days[days.length - 1]
    if (last && last.date === date) last.items.push(r)
    else days.push({ date, items: [r] })
  }
  return days
}

export type AgendaScope = 'agenda' | 'pending' | 'done' | 'all'

export interface AgendaQuery {
  /** "YYYY-MM-DD" inclusivos. */
  from: string
  to: string
  scope: AgendaScope
  keyword?: string | null
  tz: string
}

const SCOPE_STATUSES: Record<AgendaScope, ItemStatus[]> = {
  agenda: ['confirmed'],
  pending: ['proposed'],
  done: ['done'],
  all: ['confirmed', 'done', 'proposed'],
}

export interface AgendaResult {
  inRange: ItemRow[]
  /** Confirmados que já passaram da data e ainda não foram marcados como feitos. */
  overdue: ItemRow[]
  /** Confirmados sem data nenhuma. */
  undated: ItemRow[]
}

export async function queryAgenda(
  db: PingoDb,
  q: AgendaQuery,
  today: string,
): Promise<AgendaResult> {
  const rows = await listItems(db, SCOPE_STATUSES[q.scope])
  const kw = q.keyword ? normalizeName(q.keyword) : ''
  const matches = (r: ItemRow) =>
    !kw || normalizeName(`${r.title} ${r.summary ?? ''} ${r.location ?? ''}`).includes(kw)

  const inRange: ItemRow[] = []
  const overdue: ItemRow[] = []
  const undated: ItemRow[] = []
  for (const r of rows.filter(matches)) {
    const ref = r.startsAt ?? r.dueAt
    if (!ref) {
      undated.push(r)
      continue
    }
    const d = localDate(ref, q.tz)
    if (d >= q.from && d <= q.to) inRange.push(r)
    else if (d < today && r.status === 'confirmed' && d < q.from) overdue.push(r)
  }
  return { inRange, overdue, undated }
}

/** Dia → "Hoje · sex., 13/11", "Amanhã · sáb., 14/11" ou "qua., 18/11". */
export function dayHeading(date: string, today: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const short = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(d)
  const t = new Date(`${today}T12:00:00Z`)
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000)
  if (diff === 0) return `Hoje · ${short}`
  if (diff === 1) return `Amanhã · ${short}`
  if (diff === -1) return `Ontem · ${short}`
  return short
}

const KIND_EMOJI: Record<string, string> = {
  event: '📅',
  deadline: '⏳',
  task: '✅',
  authorization: '✍️',
  payment: '💸',
  info: 'ℹ️',
}

function lineFor(r: ItemRow, tz: string): string {
  const ref = r.startsAt ?? r.dueAt
  const hour = ref && !r.allDay ? localTime(ref, tz) : 'dia todo'
  const prefix = !r.startsAt && r.dueAt ? 'até ' : ''
  const where = r.location ? ` · 📍${r.location}` : ''
  const mark = r.status === 'done' ? ' ✔️' : r.status === 'proposed' ? ' (aguardando você)' : ''
  return `${KIND_EMOJI[r.kind] ?? '•'} ${prefix}${hour} · ${r.title}${where}${mark}`
}

/** Texto da resposta a uma consulta. Usa *negrito* no estilo do WhatsApp. */
export function formatAgenda(res: AgendaResult, tz: string, today: string, title: string): string {
  const parts: string[] = []
  if (res.overdue.length) {
    parts.push(
      '*Atrasados*',
      ...res.overdue.map(
        (r) => lineFor(r, tz) + ` (${dayHeading(localDate(r.startsAt ?? r.dueAt!, tz), today)})`,
      ),
      '',
    )
  }
  for (const day of groupByLocalDay(res.inRange, tz)) {
    parts.push(`*${dayHeading(day.date!, today)}*`, ...day.items.map((r) => lineFor(r, tz)), '')
  }
  if (res.undated.length) {
    parts.push('*Sem data*', ...res.undated.map((r) => lineFor(r, tz)), '')
  }
  return `${title}\n\n${parts.join('\n').trim()}`
}

/** Linhas para uma lista interativa (máx. 10): tocar numa linha abre as ações do item. */
export function itemRows(all: ItemRow[], tz: string): ListRow[] {
  return all.slice(0, 10).map((r) => {
    const ref = r.startsAt ?? r.dueAt
    return {
      id: `item:${r.id}`,
      title: r.title.slice(0, 24),
      description: ref ? formatWhen(ref, tz, r.allDay) : 'sem data',
    }
  })
}
