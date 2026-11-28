import { invoke } from '@tauri-apps/api/core'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { itemTiming, relativeWhen, schema, type PingoDb } from '@pingo/core'
import { isPermissionGranted } from '@tauri-apps/plugin-notification'

/**
 * Lembretes agendados no sistema (Android). O banco é a fonte da verdade; a cada mudança esta
 * função manda ao plugin `pingo` a lista COMPLETA dos próximos lembretes de itens confirmados.
 * O plugin guarda em disco, agenda os alarmes (hora aproximada, sem alarme exato), mostra a
 * notificação e refaz tudo depois de reiniciar o aparelho. Só título e horário saem na notificação.
 *
 * Por que não o plugin oficial de notificações: ele agenda o alarme mas não guarda nada em disco,
 * então o alarme se perde no reinício (verificado no Redmi Note 11 em 27/11/2026).
 */

export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** Teto de alarmes ao mesmo tempo: o Pingo só precisa dos próximos. */
const MAX_SCHEDULED = 60

/** Id numérico estável (o Android exige inteiro) a partir do id do lembrete. */
export function notificationId(reminderId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < reminderId.length; i++) {
    h ^= reminderId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) & 0x3fffffff
}

export interface ReconcileResult {
  scheduled: number
  cancelled: number
  late: number
}

interface OsReminder {
  id: number
  atMs: number
  title: string
  body: string
}

export async function reconcileOsReminders(
  db: PingoDb,
  tz: string,
  now: Date,
): Promise<ReconcileResult | null> {
  if (!isAndroid) return null
  if (!(await isPermissionGranted())) return null

  // Duas consultas em vez de join: as tabelas têm colunas de mesmo nome (id, status) e o driver
  // do banco entrega as linhas por posição, o que embaralharia os campos.
  const rems = await db
    .select()
    .from(schema.reminders)
    .where(
      and(eq(schema.reminders.status, 'pending'), gt(schema.reminders.remindAt, now.toISOString())),
    )
    .orderBy(schema.reminders.remindAt)
    .limit(MAX_SCHEDULED)

  const itemIds = [...new Set(rems.map((r) => r.itemId))]
  const itemRows =
    itemIds.length > 0
      ? await db.select().from(schema.items).where(inArray(schema.items.id, itemIds))
      : []
  const items = new Map(itemRows.map((i) => [i.id, i]))

  const wanted: OsReminder[] = []
  for (const r of rems) {
    const item = items.get(r.itemId)
    if (!item || item.status !== 'confirmed') continue
    const timing = itemTiming(item)
    if (timing && timing.expiresAt < now.getTime()) continue
    const ref = item.startsAt ?? item.dueAt
    const when = ref
      ? `${item.startsAt ? '' : 'até '}${relativeWhen(ref, item.allDay, tz, now)}`
      : ''
    wanted.push({
      id: notificationId(r.id),
      atMs: new Date(r.remindAt).getTime(),
      title: item.title,
      body: when || 'Lembrete',
    })
  }

  return await invoke<ReconcileResult>('os_reminders_sync', { items: wanted })
}
