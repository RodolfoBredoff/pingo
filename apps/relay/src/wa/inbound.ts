import type { IncomingEvent, MediaKind } from '@pingo/shared'
import { fromWaId } from '../phone'

/** Pedaços do webhook da Meta que nos interessam (o resto é ignorado). */
interface WaMessage {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  image?: { id?: string; mime_type?: string; caption?: string }
  document?: { id?: string; mime_type?: string; caption?: string }
  audio?: { id?: string; mime_type?: string }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string }
  }
  button?: { payload?: string; text?: string }
}

interface WaWebhook {
  entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[]
}

/** Tipos que não geram evento (reações, pedidos de sistema...). */
const SILENT = new Set(['reaction', 'system', 'unknown', 'request_welcome'])

/**
 * Extrai os eventos de um webhook. Mensagens de tipos que não sabemos ler viram um evento
 * com `unsupportedType`, para o app responder com educação (R1.1).
 */
export function parseWebhook(body: unknown): IncomingEvent[] {
  const out: IncomingEvent[] = []
  const hook = body as WaWebhook
  for (const entry of hook?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        const ev = toEvent(m)
        if (ev) out.push(ev)
      }
    }
  }
  return out
}

function toEvent(m: WaMessage): IncomingEvent | null {
  if (!m.id || !m.from || !m.type) return null
  if (SILENT.has(m.type)) return null
  const common = {
    channel: 'whatsapp' as const,
    channelMsgId: m.id,
    fromPhone: fromWaId(m.from),
    receivedAt: new Date((Number(m.timestamp) || Date.now() / 1000) * 1000).toISOString(),
  }

  switch (m.type) {
    case 'text':
      return { type: 'message', ...common, text: m.text?.body ?? '' }
    case 'image':
      return media(common, 'image', m.image, m.image?.caption)
    case 'audio':
      return media(common, 'audio', m.audio)
    case 'document':
      return m.document?.mime_type === 'application/pdf'
        ? media(common, 'pdf', m.document, m.document.caption)
        : { type: 'message', ...common, unsupportedType: 'document' }
    case 'interactive': {
      const id = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id
      return id ? { type: 'button', ...common, buttonId: id } : null
    }
    case 'button':
      // Resposta rápida de um modelo: o `payload` é o id que enviamos no modelo.
      return m.button?.payload ? { type: 'button', ...common, buttonId: m.button.payload } : null
    default:
      return { type: 'message', ...common, unsupportedType: m.type }
  }
}

function media(
  common: { channel: 'whatsapp'; channelMsgId: string; fromPhone: string; receivedAt: string },
  kind: MediaKind,
  file: { id?: string; mime_type?: string } | undefined,
  caption?: string,
): IncomingEvent {
  if (!file?.id) return { type: 'message', ...common, unsupportedType: kind }
  return {
    type: 'message',
    ...common,
    ...(caption ? { text: caption } : {}),
    // A Meta não informa o tamanho no webhook; o limite é conferido ao baixar.
    media: {
      kind,
      mimeType: file.mime_type ?? 'application/octet-stream',
      sizeBytes: 0,
      ref: file.id,
    },
  }
}
