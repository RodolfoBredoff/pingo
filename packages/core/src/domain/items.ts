import type { ItemCard } from '@pingo/shared'
import type { ExtractedItem, ItemPatch } from '../ai/extraction-schema'
import type { contacts as contactsTable, items } from '../db/schema'
import type { MissingField } from '../db/schema'
import { formatWhen, isDateOnlyLocal, localDate, localTime, localToUtcIso } from '../time'
import { matchContact } from './contacts-match'
import { describeDefaultReminder } from './reminders'

export type ItemRow = typeof items.$inferSelect
export type ItemInsert = typeof items.$inferInsert
export type ContactRow = typeof contactsTable.$inferSelect

const hasTime = (raw: string | null | undefined) => !!raw && !isDateOnlyLocal(raw)

/** Para valores sem hora real (00:00/23:59), guarda só a data. */
const dayOnly = (raw: string) => (isDateOnlyLocal(raw) ? raw.slice(0, 10) : raw)

function cleanText(s: string | null | undefined, max: number): string | null {
  const t = s?.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

function computeMissing(
  r: Pick<ItemRow, 'kind' | 'startsAt' | 'dueAt' | 'location'>,
): MissingField[] {
  const missing: MissingField[] = []
  if (!r.startsAt && !r.dueAt) missing.push('when')
  if (r.kind === 'event' && !r.location) missing.push('where')
  return missing
}

/** Converte a saída do modelo (datas locais) em linha do banco (datas UTC). */
export function extractedToRow(
  it: ExtractedItem,
  ctx: {
    id: string
    tz: string
    now: Date
    sourceMessageId: string | null
    contacts: ContactRow[]
  },
): ItemInsert {
  const startsAt = it.start ? localToUtcIso(dayOnly(it.start), ctx.tz) : null
  const endsAt = it.end ? localToUtcIso(dayOnly(it.end), ctx.tz) : null
  const dueAt = it.due ? localToUtcIso(dayOnly(it.due), ctx.tz) : null
  const reference = it.start && startsAt ? it.start : it.due && dueAt ? it.due : null
  const allDay = reference ? !hasTime(reference) : it.all_day
  const assignee = matchContact(it.assignee_hint, ctx.contacts)
  const nowIso = ctx.now.toISOString()
  const base = {
    id: ctx.id,
    sourceMessageId: ctx.sourceMessageId,
    kind: it.kind,
    title: cleanText(it.title, 80) ?? 'Sem título',
    summary: cleanText(it.summary, 200),
    startsAt,
    endsAt,
    allDay,
    dueAt,
    location: cleanText(it.location, 120),
    assigneeContactId: assignee?.id ?? null,
    status: 'proposed' as const,
    confidence: Math.min(1, Math.max(0, it.confidence)),
    evidence: cleanText(it.evidence, 300),
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  return { ...base, missingFields: computeMissing(base) }
}

/** Visão do item em campos locais, para o modelo aplicar ajustes (editar). */
export function toLocalSnapshot(r: ItemRow, tz: string, contacts: ContactRow[]) {
  const local = (iso: string | null) => {
    if (!iso) return null
    return r.allDay ? localDate(iso, tz) : `${localDate(iso, tz)}T${localTime(iso, tz)}:00`
  }
  return {
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    start: local(r.startsAt),
    end: local(r.endsAt),
    due: local(r.dueAt),
    all_day: r.allDay,
    location: r.location,
    assignee: contacts.find((c) => c.id === r.assigneeContactId)?.name ?? null,
  }
}

export interface PatchOutcome {
  changes: Partial<ItemInsert>
  /** Nome pedido para responsável que não bate com nenhum contato. */
  unmatchedAssignee: string | null
}

/** Aplica o ajuste do modelo ao item e devolve as colunas a atualizar. */
export function applyPatch(
  r: ItemRow,
  p: ItemPatch,
  ctx: { tz: string; now: Date; contacts: ContactRow[] },
): PatchOutcome {
  const changes: Partial<ItemInsert> = {}
  let unmatchedAssignee: string | null = null

  if (p.kind) changes.kind = p.kind
  if (p.title) changes.title = cleanText(p.title, 80) ?? r.title
  if (p.summary) changes.summary = cleanText(p.summary, 200)
  if (p.location) changes.location = cleanText(p.location, 120)

  const setDate = (field: 'startsAt' | 'endsAt' | 'dueAt', raw: string | null) => {
    if (!raw) return
    const utc = localToUtcIso(dayOnly(raw), ctx.tz)
    if (!utc) return
    changes[field] = utc
    if (field !== 'endsAt') changes.allDay = !hasTime(raw)
  }
  setDate('startsAt', p.start)
  setDate('endsAt', p.end)
  setDate('dueAt', p.due)
  if (p.all_day !== null && changes.allDay === undefined) changes.allDay = p.all_day

  if (p.assignee_hint) {
    const c = matchContact(p.assignee_hint, ctx.contacts)
    if (c) changes.assigneeContactId = c.id
    else unmatchedAssignee = p.assignee_hint
  }

  for (const field of p.clear) {
    if (field === 'start') changes.startsAt = null
    if (field === 'end') changes.endsAt = null
    if (field === 'due') changes.dueAt = null
    if (field === 'location') changes.location = null
    if (field === 'assignee') changes.assigneeContactId = null
  }

  const merged = { ...r, ...changes }
  changes.missingFields = computeMissing(merged)
  changes.updatedAt = ctx.now.toISOString()
  return { changes, unmatchedAssignee }
}

export const CARD_LABELS = {
  when: 'Quando',
  where: 'Onde',
  who: 'Responsável',
  reminder: 'Lembrete',
} as const

/** Monta o cartão "Entendi assim" (design.md §8). */
export function buildItemCard(r: ItemRow, tz: string, contacts: ContactRow[]): ItemCard {
  let when: string | null = null
  if (r.startsAt) {
    when = formatWhen(r.startsAt, tz, r.allDay)
    if (r.endsAt && !r.allDay) when += ` – ${localTime(r.endsAt, tz)}`
  } else if (r.dueAt) {
    when = `até ${formatWhen(r.dueAt, tz, r.allDay)}`
  }
  const hasDate = !!(r.startsAt ?? r.dueAt)
  const assignee = contacts.find((c) => c.id === r.assigneeContactId)?.name

  return {
    itemId: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary ?? undefined,
    fields: [
      { key: 'when', label: CARD_LABELS.when, value: when },
      { key: 'where', label: CARD_LABELS.where, value: r.location },
      { key: 'who', label: CARD_LABELS.who, value: assignee ?? 'Você' },
      {
        key: 'reminder',
        label: CARD_LABELS.reminder,
        value: describeDefaultReminder(r.kind, hasDate, !r.allDay && hasDate),
      },
    ],
    actions: [
      { id: `confirm:${r.id}`, title: 'Confirmar' },
      { id: `edit:${r.id}`, title: 'Editar' },
      { id: `discard:${r.id}`, title: 'Descartar' },
    ],
  }
}
