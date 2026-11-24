import type { ItemCard, OutgoingMessage, PlainMessage, TemplateMessage } from '@pingo/shared'

/**
 * Conversão do que o Pingo diz para o que o WhatsApp aceita (limites da API da Meta).
 * O relay valida de novo, mas aqui já cortamos o que passa do limite para nada ser recusado.
 */

const MAX_TEXT = 4000
const MAX_BODY = 1024
const MAX_ROW_TITLE = 24
const MAX_ROW_DESC = 72
const MAX_LABEL = 20

export interface WireBatch {
  /** Primeira parte = a mensagem principal. As demais só saem se a principal for mensagem livre. */
  parts: (PlainMessage | TemplateMessage)[]
  fallback?: TemplateMessage
}

const KIND_EMOJI: Record<string, string> = {
  event: '📅',
  deadline: '⏳',
  task: '✅',
  authorization: '✍️',
  payment: '💸',
  info: 'ℹ️',
}
const FIELD_ICON: Record<string, string> = { when: '🗓', where: '📍', who: '👤', reminder: '🔔' }

/** Texto do cartão "Entendi assim" para o WhatsApp (que não desenha cartões). */
export function renderCardText(card: ItemCard): string {
  const head = `${KIND_EMOJI[card.kind] ?? '•'} *${card.title.slice(0, 200)}*`
  const summary = card.summary ? `\n${card.summary.slice(0, 300)}` : ''
  const lines = card.fields.map(
    (f) => `${FIELD_ICON[f.key] ?? '•'} ${f.label}: ${f.value ?? 'não informado'}`,
  )
  return clip(`${head}${summary}\n\n${lines.join('\n')}`, MAX_BODY)
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…'
}

/** Quebra um texto longo em pedaços, de preferência em linhas em branco ou quebras de linha. */
export function splitText(text: string, max = MAX_TEXT): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    const cut = Math.max(
      rest.lastIndexOf('\n\n', max),
      rest.lastIndexOf('\n', max),
      rest.lastIndexOf(' ', max),
    )
    const at = cut > max / 2 ? cut : max
    out.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

export function toWire(m: OutgoingMessage): WireBatch {
  switch (m.type) {
    case 'template':
      return { parts: [m] }
    case 'text':
      return {
        parts: splitText(m.text).map((text) => ({ type: 'text' as const, text })),
        fallback: m.fallback,
      }
    case 'buttons': {
      const buttons = m.buttons.slice(0, 3)
      if (m.text.length <= MAX_BODY) {
        return { parts: [{ type: 'buttons', text: m.text, buttons }], fallback: m.fallback }
      }
      // Corpo grande demais para um botão: o texto vai inteiro e os botões vêm logo depois.
      return {
        parts: [
          ...splitText(m.text).map((text) => ({ type: 'text' as const, text })),
          { type: 'buttons', text: 'Escolha uma opção:', buttons },
        ],
        fallback: m.fallback,
      }
    }
    case 'list': {
      const rows = m.rows.slice(0, 10).map((r) => ({
        id: r.id,
        title: clip(r.title, MAX_ROW_TITLE),
        ...(r.description ? { description: clip(r.description, MAX_ROW_DESC) } : {}),
      }))
      const label = clip(m.buttonLabel, MAX_LABEL)
      if (m.text.length <= MAX_BODY) {
        return {
          parts: [{ type: 'list', text: m.text, buttonLabel: label, rows }],
          fallback: m.fallback,
        }
      }
      return {
        parts: [
          ...splitText(m.text).map((text) => ({ type: 'text' as const, text })),
          { type: 'list', text: 'Escolha uma opção:', buttonLabel: label, rows },
        ],
        fallback: m.fallback,
      }
    }
    case 'card':
      return {
        parts: [
          {
            type: 'buttons',
            text: renderCardText(m.card),
            buttons: m.card.actions
              .slice(0, 3)
              .map((a) => ({ id: a.id, title: clip(a.title, 20) })),
          },
        ],
      }
  }
}
