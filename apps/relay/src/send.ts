import { WA_WINDOW_MS, type WireMessage, type WireTemplate } from '@pingo/shared'
import { fail, type HttpResult } from './http'
import { maskPhone } from './log'
import { WaError, type Deps } from './ports'
import { InvalidMessage, toWaPayload } from './wa/outbound'

/** Folga para não enviar mensagem livre no último minuto da janela. */
const WINDOW_MARGIN_MS = 5 * 60 * 1000

export async function windowOpen(deps: Deps, phone: string): Promise<boolean> {
  const w = await deps.db.get('WINDOW', phone)
  const last = typeof w?.lastInboundMs === 'number' ? w.lastInboundMs : 0
  return deps.clock().getTime() - last < WA_WINDOW_MS - WINDOW_MARGIN_MS
}

export type Delivery =
  | { ok: true; messageId: string; via: 'free' | 'template' }
  | {
      ok: false
      code: 'window_closed' | 'bad_request' | 'whatsapp_error' | 'not_configured'
      detail?: string
    }

/**
 * Envia para um número permitido: mensagem livre dentro da janela de 24 h; fora dela, o modelo de
 * reserva (se houver). Nunca decide sozinho trocar texto por modelo: quem conhece o modelo certo é o app.
 */
export async function deliver(
  deps: Deps,
  to: string,
  message: WireMessage,
  fallback?: WireTemplate,
): Promise<Delivery> {
  try {
    // Valida tudo antes de decidir o caminho: um pedido malformado nunca vira "janela fechada".
    const primary = toWaPayload(to, message)
    const backup = fallback ? toWaPayload(to, fallback) : undefined
    let payload = primary
    let via: 'free' | 'template' = message.type === 'template' ? 'template' : 'free'
    if (message.type !== 'template' && !(await windowOpen(deps, to))) {
      if (!backup) return { ok: false, code: 'window_closed' }
      payload = backup
      via = 'template'
    }
    const { messageId } = await deps.wa.send(payload)
    return { ok: true, messageId, via }
  } catch (e) {
    if (e instanceof InvalidMessage) return { ok: false, code: 'bad_request', detail: e.message }
    if (e instanceof WaError) {
      deps.log.warn('a Meta recusou o envio', {
        to: maskPhone(to),
        status: e.status,
        code: e.code,
      })
      if (e.status === 503) return { ok: false, code: 'not_configured' }
      return {
        ok: false,
        code: 'whatsapp_error',
        detail: `meta_${e.status}${e.code ? `_${e.code}` : ''}`,
      }
    }
    throw e
  }
}

export function deliveryFailure(d: Extract<Delivery, { ok: false }>): HttpResult {
  return fail(d.code, d.detail)
}
