import { localDate, localTime, localToUtcIso, type Extraction, type ExtractedItem } from '../../src'

export interface ExpectedItem {
  kind: string[]
  date?: string[]
  time?: string
  endTime?: string
  location?: string
  noLocation?: boolean
  noDate?: boolean
  assignee?: string
}

export interface Expectation {
  actionable: boolean
  items?: ExpectedItem[]
  maxItems?: number
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function itemDate(it: ExtractedItem, tz: string): string | null {
  const raw = it.start ?? it.due
  if (!raw) return null
  const utc = localToUtcIso(raw, tz)
  return utc ? localDate(utc, tz) : null
}

function itemTime(raw: string | null, tz: string): string | null {
  if (!raw || !raw.includes('T')) return null
  const utc = localToUtcIso(raw, tz)
  return utc ? localTime(utc, tz) : null
}

/** Devolve os motivos pelos quais o item real NÃO atende ao esperado (vazio = atende). */
function mismatch(actual: ExtractedItem, exp: ExpectedItem, tz: string): string[] {
  const why: string[] = []
  if (!exp.kind.includes(actual.kind)) why.push(`tipo ${actual.kind}`)
  if (exp.noDate) {
    if (actual.start || actual.due) why.push(`inventou data (${actual.start ?? actual.due})`)
  } else if (exp.date) {
    const d = itemDate(actual, tz)
    if (!d || !exp.date.includes(d)) why.push(`data ${d ?? 'nula'}`)
  }
  if (exp.time) {
    const t = itemTime(actual.start ?? actual.due, tz)
    if (t !== exp.time) why.push(`hora ${t ?? 'nula'}`)
  }
  if (exp.endTime) {
    const t = itemTime(actual.end, tz)
    if (t !== exp.endTime) why.push(`fim ${t ?? 'nulo'}`)
  }
  if (exp.location && !norm(actual.location ?? '').includes(norm(exp.location))) {
    why.push(`local "${actual.location ?? 'nulo'}"`)
  }
  if (exp.noLocation && actual.location) why.push(`inventou local ("${actual.location}")`)
  if (exp.assignee) {
    const hay = norm(`${actual.assignee_hint ?? ''} ${actual.title} ${actual.summary ?? ''}`)
    if (!hay.includes(norm(exp.assignee))) why.push('sem responsável')
  }
  return why
}

export interface Verdict {
  pass: boolean
  reasons: string[]
}

export function evaluate(actual: Extraction, exp: Expectation, tz: string): Verdict {
  const reasons: string[] = []
  if (actual.actionable !== exp.actionable) {
    reasons.push(`actionable=${actual.actionable}, esperado ${exp.actionable}`)
  }
  if (!exp.actionable) {
    if (actual.items.length > 0) reasons.push(`${actual.items.length} item(ns) indevido(s)`)
    return { pass: reasons.length === 0, reasons }
  }

  const expected = exp.items ?? []
  const max = exp.maxItems ?? expected.length + 1
  if (actual.items.length > max) reasons.push(`itens demais (${actual.items.length} > ${max})`)

  const used = new Set<number>()
  for (const [i, e] of expected.entries()) {
    let best: { idx: number; why: string[] } | null = null
    for (const [idx, a] of actual.items.entries()) {
      if (used.has(idx)) continue
      const why = mismatch(a, e, tz)
      if (why.length === 0) {
        best = { idx, why }
        break
      }
      if (!best || why.length < best.why.length) best = { idx, why }
    }
    if (best && best.why.length === 0) used.add(best.idx)
    else
      reasons.push(
        `item esperado #${i + 1} (${e.kind.join('|')} ${e.date?.[0] ?? ''}): ${best ? best.why.join(', ') : 'ausente'}`,
      )
  }
  return { pass: reasons.length === 0, reasons }
}
