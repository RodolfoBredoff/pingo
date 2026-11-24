/**
 * Tipos de mensagem independentes de canal.
 * Usados pelo core, pelo app (simulador) e pelo relay AWS.
 */

export type ChannelId = 'simulator' | 'whatsapp'

export type MediaKind = 'image' | 'pdf' | 'audio'

export interface MediaRef {
  kind: MediaKind
  mimeType: string
  sizeBytes: number
  /** Identificador opaco do canal (id da mídia na Meta, caminho local no simulador etc.). */
  ref: string
}

export interface IncomingMessage {
  type: 'message'
  channel: ChannelId
  /** Id único no canal; base da idempotência (R1.4). */
  channelMsgId: string
  fromPhone: string
  /** ISO 8601 em UTC. */
  receivedAt: string
  text?: string
  media?: MediaRef
  /** Tipo que o Pingo não sabe ler (vídeo, figurinha, localização…): o app responde com educação. */
  unsupportedType?: string
}

export interface IncomingButtonPress {
  type: 'button'
  channel: ChannelId
  channelMsgId: string
  fromPhone: string
  receivedAt: string
  buttonId: string
}

export type IncomingEvent = IncomingMessage | IncomingButtonPress

/** WhatsApp: no máximo 3 botões, título com até 20 caracteres. */
export const MAX_BUTTONS = 3
export const MAX_BUTTON_TITLE = 20
/** WhatsApp: listas com até 10 linhas. */
export const MAX_LIST_ROWS = 10

export interface ReplyButton {
  id: string
  title: string
}

export interface ListRow {
  id: string
  title: string
  description?: string
}

export type ItemKind = 'task' | 'event' | 'deadline' | 'authorization' | 'payment' | 'info'

export type CardFieldKey = 'when' | 'where' | 'who' | 'reminder'

export interface CardField {
  key: CardFieldKey
  label: string
  /** null = "não informado" (R2.4). */
  value: string | null
}

export interface ItemCard {
  itemId: string
  kind: ItemKind
  title: string
  summary?: string
  fields: CardField[]
  actions: ReplyButton[]
}

export type TemplateName =
  'boas_vindas' | 'lembrete_item' | 'lembrete_contato' | 'oferta_responsabilidade'

/** Modelo aprovado pela Meta: único jeito de falar com alguém fora da janela de 24 h. */
export interface TemplateMessage {
  type: 'template'
  name: TemplateName
  variables: string[]
  /** Valores devolvidos quando o usuário toca nos botões de resposta rápida do modelo, em ordem. */
  buttonPayloads?: string[]
}

/** O que o WhatsApp sabe enviar sem o app converter nada. */
export type PlainMessage =
  | { type: 'text'; text: string }
  | { type: 'buttons'; text: string; buttons: ReplyButton[] }
  | { type: 'list'; text: string; buttonLabel: string; rows: ListRow[] }

export type OutgoingMessage =
  | (PlainMessage & {
      /** Modelo a usar se a janela de 24 h estiver fechada (só o canal WhatsApp usa). */
      fallback?: TemplateMessage
    })
  | { type: 'card'; card: ItemCard }
  | TemplateMessage
