import { and, eq, gt, inArray } from 'drizzle-orm'
import { itemTiming, relativeWhen, schema, type PingoDb } from '@pingo/core'
import {
  cancel,
  isPermissionGranted,
  Schedule,
  sendNotification,
} from '@tauri-apps/plugin-notification'

/**
 * Lembretes agendados no sistema (Android). O banco é a fonte da verdade; a cada mudança esta
 * função alinha os alarmes do sistema com os lembretes pendentes de itens confirmados.
 * Hora aproximada (sem alarme exato) e só título + horário na notificação.
 */

export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** Depois da hora, o alarme ainda pode ser entregue pelo sistema (janela aproximada): não cancelar. */
const FIRED_GRACE_MS = 2 * 60 * 60 * 1000

let firstRun = true

/** Teto de alarmes ao mesmo tempo: o Android aceita centenas, mas o Pingo só precisa dos próximos. */
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
  total: number
}

export async function reconcileOsReminders(
  db: PingoDb,
  tz: string,
  now: Date,
): Promise<ReconcileResult | null> {
  if (!isAndroid) return null
  if (!(await isPermissionGranted())) return null

  // Duas consultas em vez de join: as tabelas têm colunas de mesmo nome (id, status) e o driver
  // do banco entrega as linhas por nome, o que embaralharia os campos.
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

  const wanted = new Map<number, { title: string; body: string; at: Date }>()
  for (const r of rems) {
    const item = items.get(r.itemId)
    if (!item || item.status !== 'confirmed') continue
    const timing = itemTiming(item)
    if (timing && timing.expiresAt < now.getTime()) continue
    const ref = item.startsAt ?? item.dueAt
    const when = ref
      ? `${item.startsAt ? '' : 'até '}${relativeWhen(ref, item.allDay, tz, now)}`
      : ''
    wanted.set(notificationId(r.id), {
      title: item.title,
      body: when || 'Lembrete',
      at: new Date(r.remindAt),
    })
  }

  // O `pending()` do plugin devolve JSON inválido no Android; por isso o Pingo guarda a sua
  // própria lista (id → horário) e reagenda sem consultar o plugin. Mesmo id substitui o alarme.
  const stored = loadScheduled()
  // Na primeira sincronização de cada abertura do app reagenda tudo: parar o app à força
  // (ou reiniciar o aparelho em alguns modelos) apaga os alarmes sem avisar. Mesmo id = substitui.
  const have = firstRun ? {} : stored
  firstRun = false
  const nowMs = now.getTime()
  const stale: number[] = []
  const next: Record<string, string> = {}
  for (const [key, iso] of Object.entries(stored)) {
    const id = Number(key)
    if (wanted.has(id)) continue
    const at = Date.parse(iso)
    if (at > nowMs)
      stale.push(id) // item saiu da agenda ou lembrete cancelado antes da hora
    else if (at > nowMs - FIRED_GRACE_MS) next[key] = iso // já na hora: o sistema pode estar entregando
  }
  let step = 'cancel'
  try {
    if (stale.length > 0) await cancel(stale)

    step = 'schedule'
    let scheduled = 0
    for (const [id, w] of wanted) {
      const iso = w.at.toISOString()
      next[id] = iso
      if (have[id] === iso) continue
      sendNotification({
        id,
        title: w.title,
        body: w.body,
        schedule: Schedule.at(w.at, false, true),
      })
      scheduled++
    }
    saveScheduled(next)
    return { scheduled, cancelled: stale.length, total: wanted.size }
  } catch (e) {
    throw new Error(`passo ${step}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
}

const STORE_KEY = 'pingo.os-reminders.v1'

function loadScheduled(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function saveScheduled(map: Record<string, string>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map))
  } catch {
    /* sem armazenamento: na próxima sincronização reagenda tudo, sem duplicar (mesmo id) */
  }
}
