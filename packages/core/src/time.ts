/**
 * Datas e fusos horários sem bibliotecas externas (usa Intl).
 * Regra do projeto: banco em UTC; conversões só na borda (R2.3).
 */

const WEEKDAYS_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
]

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedParts(date: Date, tz: string): Parts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const out: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour!,
    minute: out.minute!,
    second: out.second!,
  }
}

/** Diferença (fuso - UTC) em ms no instante dado. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * True quando o texto não carrega hora de verdade: só data, ou 00:00 (início do dia)
 * ou 23:59 (fim do dia), que os modelos usam para dizer "sem hora".
 */
export function isDateOnlyLocal(raw: string): boolean {
  if (!raw.includes('T')) return true
  const m = /T(\d{2}):(\d{2})/.exec(raw)
  if (!m) return true
  const hhmm = `${m[1]}:${m[2]}`
  return hhmm === '00:00' || hhmm === '23:59'
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * Converte "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm[:ss]" (hora local do fuso) para ISO UTC.
 * Se o texto já trouxer deslocamento ("Z" ou "-03:00"), respeita-o.
 * Devolve null se não for uma data válida.
 */
export function localToUtcIso(local: string, tz: string): string | null {
  const text = local.trim()
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) && text.includes('T')) {
    const d = new Date(text)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const m = LOCAL_RE.exec(text)
  if (!m) return null
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m
  const naive = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s)
  const check = new Date(naive)
  if (check.getUTCMonth() !== +mo! - 1 || check.getUTCDate() !== +d!) return null
  // Duas passagens para acertar viradas de horário de verão.
  let guess = naive - tzOffsetMs(new Date(naive), tz)
  guess = naive - tzOffsetMs(new Date(guess), tz)
  return new Date(guess).toISOString()
}

/** "YYYY-MM-DD" da data local no fuso. */
export function localDate(date: Date | string, tz: string): string {
  const p = zonedParts(typeof date === 'string' ? new Date(date) : date, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** "HH:mm" da hora local no fuso. */
export function localTime(date: Date | string, tz: string): string {
  const p = zonedParts(typeof date === 'string' ? new Date(date) : date, tz)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export function weekdayPt(date: Date | string, tz: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const p = zonedParts(d, tz)
  return WEEKDAYS_PT[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]!
}

/** Início do dia local (00:00) em ISO UTC, deslocado `days` dias. */
export function startOfLocalDayUtc(now: Date, tz: string, days = 0): string {
  const p = zonedParts(now, tz)
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  const ymd = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`
  return localToUtcIso(ymd, tz)!
}

/** Início do mês local em ISO UTC. */
export function startOfLocalMonthUtc(now: Date, tz: string): string {
  const p = zonedParts(now, tz)
  return localToUtcIso(`${p.year}-${String(p.month).padStart(2, '0')}-01`, tz)!
}

/**
 * Calendário dos próximos `days` dias, para o prompt ancorar "sexta", "amanhã" etc.
 * Ex.: "- sexta-feira 2026-11-13".
 */
export function calendarLines(now: Date, tz: string, days = 14): string[] {
  const lines: string[] = []
  for (let i = 0; i < days; i++) {
    const iso = startOfLocalDayUtc(now, tz, i)
    const tag = i === 0 ? ' (hoje)' : i === 1 ? ' (amanhã)' : ''
    lines.push(`- ${weekdayPt(iso, tz)} ${localDate(iso, tz)}${tag}`)
  }
  return lines
}

/** Formata para o cartão: "sex., 13/11 · 08:00" (hora omitida para dia inteiro). */
export function formatWhen(iso: string, tz: string, allDay: boolean): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(d)
  return allDay ? day : `${day} · ${localTime(d, tz)}`
}
