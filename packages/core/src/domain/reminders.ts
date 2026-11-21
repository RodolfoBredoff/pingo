import { and, eq } from 'drizzle-orm'
import type { ItemKind } from '@pingo/shared'
import type { PingoDb } from '../db/client'
import { reminders } from '../db/schema'
import { localDate, localTime, localToUtcIso } from '../time'
import type { ItemRow } from './items'

/**
 * Lembretes padrão por tipo (R5.1). Quem calcula é o código, não a IA: é previsível e barato.
 * Só entram horários que ainda estão no futuro.
 */

const MIN = 60_000

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/** Horário de referência do item e o instante em que ele deixa de fazer sentido avisar. */
export function itemTiming(
  item: Pick<ItemRow, 'startsAt' | 'dueAt' | 'allDay'>,
): { ref: string; expiresAt: number } | null {
  const ref = item.startsAt ?? item.dueAt
  if (!ref) return null
  const t = new Date(ref).getTime()
  // Dia inteiro: vale até o fim do dia; com hora: até a hora marcada.
  return { ref, expiresAt: item.allDay ? t + 24 * 60 * MIN : t }
}

export function defaultReminderTimes(
  item: Pick<ItemRow, 'kind' | 'startsAt' | 'dueAt' | 'allDay'>,
  tz: string,
  now: Date,
): string[] {
  const timing = itemTiming(item)
  if (!timing || item.kind === 'info') return []
  const { ref, expiresAt } = timing
  const date = localDate(ref, tz)
  const at = (d: string, hhmm: string) => localToUtcIso(`${d}T${hhmm}:00`, tz)
  const timed = !item.allDay

  let candidates: (string | null)[]
  if (item.kind === 'event') {
    candidates = [
      at(addDays(date, -1), '20:00'),
      timed ? new Date(new Date(ref).getTime() - 60 * MIN).toISOString() : at(date, '08:00'),
    ]
  } else if (item.kind === 'task') {
    candidates = [at(addDays(date, -1), '09:00'), at(date, '08:00')]
  } else {
    // deadline, authorization, payment
    candidates = [at(addDays(date, -2), '09:00'), at(date, '08:00')]
  }

  const minTime = now.getTime() + 30_000
  return [...new Set(candidates.filter((c): c is string => !!c))]
    .filter((iso) => new Date(iso).getTime() > minTime && new Date(iso).getTime() < expiresAt)
    .sort()
}

/** Texto curto para o cartão e para a confirmação ("1 dia antes às 20h e 1 h antes"). */
export function describeDefaultReminder(
  kind: ItemKind,
  hasDate: boolean,
  hasTime: boolean,
): string {
  if (!hasDate) return 'Sem data, sem lembrete'
  switch (kind) {
    case 'event':
      return hasTime ? '1 dia antes às 20h e 1 h antes' : '1 dia antes às 20h e no dia às 8h'
    case 'deadline':
    case 'authorization':
    case 'payment':
      return '2 dias antes às 9h e no dia às 8h'
    case 'task':
      return '1 dia antes às 9h e no dia às 8h'
    case 'info':
      return 'Sem lembrete'
  }
}

/** Recria os lembretes pendentes do item. Devolve os horários agendados (UTC). */
export async function scheduleReminders(
  db: PingoDb,
  item: ItemRow,
  tz: string,
  now: Date,
): Promise<string[]> {
  await cancelReminders(db, item.id)
  const times = defaultReminderTimes(item, tz, now)
  for (const remindAt of times) {
    await db.insert(reminders).values({ id: crypto.randomUUID(), itemId: item.id, remindAt })
  }
  return times
}

export async function cancelReminders(db: PingoDb, itemId: string): Promise<void> {
  await db
    .update(reminders)
    .set({ status: 'cancelled' })
    .where(and(eq(reminders.itemId, itemId), eq(reminders.status, 'pending')))
}

/** "hoje às 15:00", "amanhã às 08:00", "sex., 13/11 às 15:00" para mensagens. */
export function relativeWhen(iso: string, allDay: boolean, tz: string, now: Date): string {
  const d = localDate(iso, tz)
  const today = localDate(now, tz)
  const tomorrow = localDate(new Date(now.getTime() + 24 * 60 * MIN), tz)
  const day =
    d === today
      ? 'hoje'
      : d === tomorrow
        ? 'amanhã'
        : new Intl.DateTimeFormat('pt-BR', {
            timeZone: tz,
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
          }).format(new Date(iso))
  return allDay ? day : `${day} às ${localTime(iso, tz)}`
}
