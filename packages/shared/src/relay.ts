import type { IncomingEvent, PlainMessage, TemplateMessage } from './messages'

/**
 * Contrato HTTP entre o app (RelayChannel) e o relay na AWS.
 * Todas as rotas do dispositivo exigem `Authorization: Bearer <token>`.
 */

/** Dentro de 24 h da última mensagem do usuário vale mensagem livre; fora, só modelo aprovado. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000

/** O que o relay sabe enviar. `card` é convertido pelo app em texto + botões/lista antes. */
export type WireMessage = PlainMessage | TemplateMessage
export type WireTemplate = TemplateMessage

export interface PairRequest {
  /** Código de uso único gerado com `pnpm relay:pair-code`. */
  code: string
}
export interface PairResponse {
  token: string
}

export interface InboxItem {
  /** Entregue de volta em /inbox/ack depois que o app processou. */
  receipt: string
  event: IncomingEvent
}
export interface InboxResponse {
  messages: InboxItem[]
}
export interface AckRequest {
  receipts: string[]
}
export interface AckResponse {
  acked: number
}

export interface OutboxRequest {
  /** E.164, ex.: +5511988887777. Precisa estar na lista de números permitidos. */
  to: string
  message: WireMessage
  /** Usado se a janela de 24 h estiver fechada. Sem ele, o relay responde `window_closed`. */
  fallback?: WireTemplate
}
export interface OutboxResponse {
  messageId: string
  via: 'free' | 'template'
}

export interface AllowlistRequest {
  owner: string
  contacts: string[]
}
export interface AllowlistResponse {
  owner: string
  contacts: number
}

export interface ReminderRequest {
  /** Quando enviar, ISO 8601 em UTC. */
  at: string
  to: string
  message: WireMessage
  fallback?: WireTemplate
}
export interface ReminderResponse {
  id: string
  at: string
}

export interface MediaResponse {
  /** Link temporário (5 min) para baixar o arquivo. */
  url: string
  mimeType: string
  sizeBytes: number
  expiresInSec: number
}

export interface MeResponse {
  deleted: number
}

export type RelayErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'too_large'
  | 'window_closed'
  | 'whatsapp_error'
  | 'not_configured'
  | 'internal'

export interface RelayErrorBody {
  error: RelayErrorCode
  detail?: string
}
