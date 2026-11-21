import { createHmac } from 'node:crypto'
import type { IncomingEvent } from '@pingo/shared'
import { rawBody, header, safeEqualHex, sha256Hex, type HttpEvent, type HttpResult } from '../http'
import { maskPhone } from '../log'
import { WaError, type Deps } from '../ports'
import { deliver } from '../send'
import { parseWebhook } from '../wa/inbound'

export const MAX_WEBHOOK_BYTES = 256 * 1024
const DAY_S = 24 * 60 * 60
/** Sem sinal do app há mais que isso = offline. O long polling renova a cada poucos segundos. */
export const OFFLINE_AFTER_MS = 90_000
export const AUTOREPLY_EVERY_MS = 10 * 60 * 1000
export const OFFLINE_TEXT = 'Recebi! Organizo assim que o Pingo abrir. 💛'

type WebhookEvent = HttpEvent & { requestContext?: { http?: { method?: string } } }

const text = (status: number, body: string): HttpResult => ({
  statusCode: status,
  headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
  body,
})

export async function webhook(deps: Deps, e: WebhookEvent): Promise<HttpResult> {
  const method = e.requestContext?.http?.method ?? 'POST'
  return method === 'GET' ? verify(deps, e) : receive(deps, e)
}

/** Passo único de configuração: a Meta pergunta se o endereço é nosso. */
async function verify(deps: Deps, e: WebhookEvent): Promise<HttpResult> {
  const q = e.queryStringParameters ?? {}
  const expected = await deps.secrets.get('verify-token')
  if (!expected) return text(503, 'not_configured')
  const given = q['hub.verify_token'] ?? ''
  const same = safeEqualHex(sha256Hex(given), sha256Hex(expected))
  if (q['hub.mode'] === 'subscribe' && same && q['hub.challenge']) {
    return text(200, q['hub.challenge'])
  }
  return text(403, 'forbidden')
}

export function signatureOf(secret: string, body: Buffer): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

async function receive(deps: Deps, e: WebhookEvent): Promise<HttpResult> {
  const raw = rawBody(e)
  if (raw.length > MAX_WEBHOOK_BYTES) return text(413, 'too_large')

  const secret = await deps.secrets.get('app-secret')
  if (!secret) return text(503, 'not_configured')
  // Falha fechada: sem assinatura válida, nada é lido nem guardado.
  const given = (header(e, 'x-hub-signature-256') ?? '').replace(/^sha256=/, '')
  const want = signatureOf(secret, raw).replace(/^sha256=/, '')
  if (!safeEqualHex(given, want)) {
    deps.log.warn('assinatura inválida')
    return text(401, 'unauthorized')
  }

  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    return text(400, 'bad_request')
  }

  const stats = { queued: 0, duplicate: 0, dropped: 0 }
  for (const ev of parseWebhook(body)) {
    const r = await handleEvent(deps, ev)
    stats[r]++
  }
  deps.log.info('webhook processado', stats)
  // Sempre 200 quando a assinatura é válida: a Meta reenvia em qualquer outro código.
  return text(200, 'ok')
}

async function handleEvent(
  deps: Deps,
  ev: IncomingEvent,
): Promise<'queued' | 'duplicate' | 'dropped'> {
  const allowed = await deps.db.get('ALLOW', ev.fromPhone)
  if (!allowed) {
    // Número desconhecido: ignorado em silêncio e sem guardar nada (R6.3, R7).
    deps.log.info('número fora da lista ignorado', { from: maskPhone(ev.fromPhone) })
    return 'dropped'
  }
  if (await deps.db.get('IDEMP', ev.channelMsgId)) return 'duplicate'

  const nowMs = deps.clock().getTime()
  await deps.db.put({
    pk: 'WINDOW',
    sk: ev.fromPhone,
    lastInboundMs: nowMs,
    ttl: Math.floor(nowMs / 1000) + 2 * DAY_S,
  })
  // Fila primeiro, marca de idempotência depois: se a fila falhar, a Meta reenvia e nada se perde.
  await deps.queue.send(JSON.stringify(ev), ev.channelMsgId, ev.fromPhone.replace(/\D/g, ''))
  await deps.db.put({
    pk: 'IDEMP',
    sk: ev.channelMsgId,
    ttl: Math.floor(nowMs / 1000) + 7 * DAY_S,
  })

  if (allowed.role === 'owner') await maybeAutoReply(deps, ev.fromPhone, nowMs)
  return 'queued'
}

/** R9.4: com o app offline, avisa "Recebi!" no máximo uma vez a cada 10 minutos. */
async function maybeAutoReply(deps: Deps, phone: string, nowMs: number): Promise<void> {
  const dev = await deps.db.get('DEVICE', 'main')
  const seen = typeof dev?.lastSeenMs === 'number' ? dev.lastSeenMs : 0
  if (nowMs - seen < OFFLINE_AFTER_MS) return
  if (!(await deps.db.claimSlot('AUTOREPLY', phone, nowMs, AUTOREPLY_EVERY_MS))) return
  try {
    const r = await deliver(deps, phone, { type: 'text', text: OFFLINE_TEXT })
    if (!r.ok) deps.log.warn('aviso offline não enviado', { code: r.code })
  } catch (e) {
    // O aviso é um extra: a mensagem já está na fila.
    deps.log.warn('aviso offline falhou', { error: e instanceof WaError ? 'whatsapp' : 'interno' })
  }
}
