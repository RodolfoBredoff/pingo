import type {
  AckRequest,
  AckResponse,
  AllowlistRequest,
  AllowlistResponse,
  InboxResponse,
  MeResponse,
  MediaResponse,
  OutboxRequest,
  OutboxResponse,
  PairRequest,
  PairResponse,
  ReminderRequest,
  ReminderResponse,
} from '@pingo/shared'
import {
  BadRequest,
  authenticate,
  fail,
  json,
  newToken,
  parseJson,
  sha256Hex,
  touchDevice,
  type HttpEvent,
  type HttpResult,
} from '../http'
import { E164, canonicalPhone } from '../phone'
import { WaError, type Deps } from '../ports'
import { deliver, deliveryFailure } from '../send'
import { toWaPayload, InvalidMessage } from '../wa/outbound'

const DAY_S = 24 * 60 * 60
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024
export const MEDIA_LINK_SECONDS = 300
export const INBOX_VISIBILITY_S = 120
const ID = /^[A-Za-z0-9_-]{8,64}$/
const MEDIA_ID = /^\d{5,40}$/

// ------------------------------------------------------------------ pareamento

/** Troca o código de uso único (gerado com `pnpm relay:pair-code`) por um token de dispositivo. */
export async function pair(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const { code } = parseJson<Partial<PairRequest>>(e)
  if (typeof code !== 'string' || code.length < 16 || code.length > 64) return fail('unauthorized')
  const hash = sha256Hex(code.replace(/[\s-]/g, '').toUpperCase())
  const entry = await deps.db.get('PAIR', hash)
  // Uso único: apaga antes de qualquer outra coisa.
  await deps.db.delete('PAIR', hash)
  const expiresMs = typeof entry?.expiresMs === 'number' ? entry.expiresMs : 0
  if (!entry || expiresMs < deps.clock().getTime()) return fail('unauthorized')

  const token = newToken()
  // Parear de novo substitui (e portanto revoga) o token anterior.
  await deps.db.put({
    pk: 'DEVICE',
    sk: 'main',
    tokenHash: sha256Hex(token),
    pairedMs: deps.clock().getTime(),
    lastSeenMs: 0,
  })
  deps.log.info('dispositivo pareado')
  const body: PairResponse = { token }
  return json(200, body)
}

// ----------------------------------------------------------------- caixa de entrada

/** Long polling: espera até `wait` segundos (máx. 20) por mensagens da fila. */
export async function inbox(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  const q = e.queryStringParameters ?? {}
  const wait = clamp(Number(q.wait ?? 0), 0, 20)
  const max = clamp(Number(q.max ?? 10), 1, 10)
  await touchDevice(deps)
  const got = await deps.queue.receive(max, wait, INBOX_VISIBILITY_S)
  await touchDevice(deps)

  const body: InboxResponse = { messages: [] }
  for (const m of got) {
    try {
      body.messages.push({ receipt: m.receipt, event: JSON.parse(m.body) })
    } catch {
      // Mensagem ilegível: fica sem ack e vai para a fila de falhas depois de algumas tentativas.
      deps.log.error('mensagem ilegível na fila')
    }
  }
  return json(200, body)
}

export async function ack(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  const { receipts } = parseJson<Partial<AckRequest>>(e)
  if (
    !Array.isArray(receipts) ||
    receipts.length > 10 ||
    receipts.some((r) => typeof r !== 'string')
  ) {
    throw new BadRequest('receipts inválido')
  }
  const acked = receipts.length ? await deps.queue.delete(receipts) : 0
  const body: AckResponse = { acked }
  return json(200, body)
}

// ---------------------------------------------------------------------- envio

async function isAllowed(deps: Deps, phone: string): Promise<boolean> {
  return !!(await deps.db.get('ALLOW', phone))
}

function phoneOf(v: unknown): string {
  if (typeof v !== 'string') throw new BadRequest('telefone inválido')
  const p = canonicalPhone(v)
  if (!E164.test(p)) throw new BadRequest('telefone inválido')
  return p
}

/** Só envia para números da lista: o relay não serve de porta aberta para mandar mensagem a qualquer um. */
export async function outbox(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  const req = parseJson<Partial<OutboxRequest>>(e)
  const to = phoneOf(req.to)
  if (!req.message || typeof req.message !== 'object') throw new BadRequest('message ausente')
  if (!(await isAllowed(deps, to))) return fail('forbidden')

  const r = await deliver(deps, to, req.message, req.fallback)
  if (!r.ok) return deliveryFailure(r)
  const body: OutboxResponse = { messageId: r.messageId, via: r.via }
  return json(200, body)
}

// ---------------------------------------------------------------------- mídia

export async function media(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  const id = e.pathParameters?.id ?? ''
  if (!MEDIA_ID.test(id)) throw new BadRequest('id de mídia inválido')
  try {
    const file = await deps.wa.getMedia(id, MAX_MEDIA_BYTES)
    const key = `media/${id}`
    await deps.files.put(key, file.data, file.mimeType)
    const body: MediaResponse = {
      url: await deps.files.presignGet(key, MEDIA_LINK_SECONDS),
      mimeType: file.mimeType,
      sizeBytes: file.data.length,
      expiresInSec: MEDIA_LINK_SECONDS,
    }
    return json(200, body)
  } catch (err) {
    if (err instanceof WaError) {
      if (err.status === 413) return fail('too_large')
      if (err.status === 503) return fail('not_configured')
      deps.log.warn('mídia não baixada', { status: err.status, code: err.code })
      return fail('whatsapp_error', `meta_${err.status}`)
    }
    throw err
  }
}

// ----------------------------------------------------------- lista de permitidos

/** Substitui a lista inteira: o dono e os contatos cadastrados. */
export async function allowlist(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  const req = parseJson<Partial<AllowlistRequest>>(e)
  const owner = phoneOf(req.owner)
  if (!Array.isArray(req.contacts) || req.contacts.length > 50)
    throw new BadRequest('contacts inválido')
  const contacts = [...new Set(req.contacts.map(phoneOf))].filter((c) => c !== owner)

  const want = new Map<string, 'owner' | 'contact'>([[owner, 'owner']])
  for (const c of contacts) want.set(c, 'contact')
  for (const item of await deps.db.query('ALLOW')) {
    if (!want.has(item.sk)) await deps.db.delete('ALLOW', item.sk)
  }
  for (const [phone, role] of want) await deps.db.put({ pk: 'ALLOW', sk: phone, role })
  const body: AllowlistResponse = { owner, contacts: contacts.length }
  return json(200, body)
}

// ------------------------------------------------------------------ lembretes

export async function putReminder(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  const id = e.pathParameters?.id ?? ''
  if (!ID.test(id)) throw new BadRequest('id inválido')
  const req = parseJson<Partial<ReminderRequest>>(e)
  const to = phoneOf(req.to)
  const atMs = typeof req.at === 'string' ? Date.parse(req.at) : NaN
  const now = deps.clock().getTime()
  if (!Number.isFinite(atMs)) throw new BadRequest('at inválido')
  if (atMs < now + 5_000) throw new BadRequest('at já passou')
  if (atMs > now + 400 * DAY_S * 1000) throw new BadRequest('at distante demais')
  if (!req.message || typeof req.message !== 'object') throw new BadRequest('message ausente')
  if (!(await isAllowed(deps, to))) return fail('forbidden')
  try {
    // Valida já na criação: erro de formato só apareceria na hora de enviar.
    toWaPayload(to, req.message)
    if (req.fallback) toWaPayload(to, req.fallback)
  } catch (err) {
    if (err instanceof InvalidMessage) throw new BadRequest(err.message)
    throw err
  }

  const at = new Date(atMs).toISOString()
  await deps.db.put({
    pk: 'REMINDER',
    sk: id,
    at,
    to,
    message: req.message,
    ...(req.fallback ? { fallback: req.fallback } : {}),
    ttl: Math.floor(atMs / 1000) + 3 * DAY_S,
  })
  await deps.scheduler.upsert({ id, at })
  const body: ReminderResponse = { id, at }
  return json(200, body)
}

export async function deleteReminder(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  const id = e.pathParameters?.id ?? ''
  if (!ID.test(id)) throw new BadRequest('id inválido')
  await deps.scheduler.remove(id)
  await deps.db.delete('REMINDER', id)
  return json(200, { id })
}

/** Alvo do EventBridge Scheduler. Qualquer falha lança erro: o Scheduler tenta de novo e, no fim, usa a fila de falhas. */
export async function sendReminder(deps: Deps, event: { id?: string }): Promise<void> {
  const id = event.id ?? ''
  const item = await deps.db.get('REMINDER', id)
  if (!item) {
    deps.log.info('lembrete já cancelado ou enviado')
    return
  }
  const r = await deliver(
    deps,
    String(item.to),
    item.message as ReminderRequest['message'],
    item.fallback as ReminderRequest['fallback'],
  )
  if (!r.ok) {
    deps.log.error('lembrete não enviado', { code: r.code })
    throw new Error(`lembrete não enviado: ${r.code}`)
  }
  await deps.db.delete('REMINDER', id)
  deps.log.info('lembrete enviado', { via: r.via })
}

// ------------------------------------------------------------------------ apagar

/** "Apagar meus dados" na nuvem (R7.4): agendamentos, fila, mídia temporária e todos os registros. */
export async function eraseMe(deps: Deps, e: HttpEvent): Promise<HttpResult> {
  const denied = await authenticate(deps, e)
  if (denied) return denied
  await deps.scheduler.removeAll()
  await deps.queue.purge()
  const files = await deps.files.deleteAll()
  const rows = await deps.db.clear()
  deps.log.info('dados do dono apagados', { rows, files })
  const body: MeResponse = { deleted: rows + files }
  return json(200, body)
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : min
}
