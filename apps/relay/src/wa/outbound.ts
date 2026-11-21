import {
  MAX_BUTTONS,
  MAX_BUTTON_TITLE,
  MAX_LIST_ROWS,
  type WireMessage,
  type WireTemplate,
} from '@pingo/shared'
import { toWaId } from '../phone'
import type { WaPayload } from '../ports'

/** Limites da API de mensagens da Meta. */
const LIMITS = {
  text: 4096,
  body: 1024,
  listButton: 20,
  rowTitle: 24,
  rowDescription: 72,
  id: 256,
  templateParam: 1024,
}

export class InvalidMessage extends Error {}

const TEMPLATES = new Set(['boas_vindas', 'lembrete_item', 'oferta_responsabilidade'])
const LANGUAGE = 'pt_BR'

/** Modelos não aceitam quebra de linha, tab nem 4 espaços seguidos em variáveis. */
export function cleanTemplateParam(v: string): string {
  return v
    .replace(/\s*[\r\n\t]+\s*/g, ' · ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, LIMITS.templateParam)
}

function need(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new InvalidMessage(msg)
}

/** Converte a mensagem do Pingo no corpo da API da Meta. */
export function toWaPayload(to: string, m: WireMessage | WireTemplate): WaPayload {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: toWaId(to) }
  switch (m.type) {
    case 'text': {
      need(typeof m.text === 'string' && m.text.length > 0, 'texto vazio')
      need(m.text.length <= LIMITS.text, `texto passa de ${LIMITS.text} caracteres`)
      return { ...base, type: 'text', text: { body: m.text, preview_url: false } }
    }
    case 'buttons': {
      need(m.text.length > 0 && m.text.length <= LIMITS.body, 'texto do corpo inválido')
      need(m.buttons.length >= 1 && m.buttons.length <= MAX_BUTTONS, `de 1 a ${MAX_BUTTONS} botões`)
      for (const b of m.buttons) {
        need(b.title.length > 0 && b.title.length <= MAX_BUTTON_TITLE, `título de botão inválido`)
        need(b.id.length > 0 && b.id.length <= LIMITS.id, 'id de botão inválido')
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: m.text },
          action: {
            buttons: m.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
          },
        },
      }
    }
    case 'list': {
      need(m.text.length > 0 && m.text.length <= LIMITS.body, 'texto do corpo inválido')
      need(m.buttonLabel.length > 0 && m.buttonLabel.length <= LIMITS.listButton, 'rótulo inválido')
      need(m.rows.length >= 1 && m.rows.length <= MAX_LIST_ROWS, `de 1 a ${MAX_LIST_ROWS} linhas`)
      for (const r of m.rows) {
        need(r.title.length > 0 && r.title.length <= LIMITS.rowTitle, 'título de linha inválido')
        need(r.id.length > 0 && r.id.length <= LIMITS.id, 'id de linha inválido')
        need((r.description?.length ?? 0) <= LIMITS.rowDescription, 'descrição de linha longa')
      }
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: m.text },
          action: {
            button: m.buttonLabel,
            sections: [
              {
                title: 'Opções',
                rows: m.rows.map((r) => ({
                  id: r.id,
                  title: r.title,
                  ...(r.description ? { description: r.description } : {}),
                })),
              },
            ],
          },
        },
      }
    }
    case 'template': {
      need(TEMPLATES.has(m.name), 'modelo desconhecido')
      need(m.variables.length <= 10, 'variáveis demais')
      const components: Record<string, unknown>[] = []
      if (m.variables.length > 0) {
        components.push({
          type: 'body',
          parameters: m.variables.map((v) => ({ type: 'text', text: cleanTemplateParam(v) })),
        })
      }
      ;(m.buttonPayloads ?? []).slice(0, 3).forEach((payload, i) => {
        need(payload.length > 0 && payload.length <= 128, 'payload de botão inválido')
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(i),
          parameters: [{ type: 'payload', payload }],
        })
      })
      return {
        ...base,
        type: 'template',
        template: { name: m.name, language: { code: LANGUAGE }, components },
      }
    }
    default:
      throw new InvalidMessage('tipo de mensagem não suportado')
  }
}
