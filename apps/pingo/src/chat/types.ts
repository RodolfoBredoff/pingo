import type { ItemCard, ListRow, ReplyButton } from '@pingo/shared'

/** O que aparece no chat. É o que também é guardado na tabela chat_log. */
export type ChatBody =
  | { type: 'text'; text: string }
  | {
      type: 'attachment'
      kind: 'image' | 'pdf' | 'audio'
      name: string
      caption?: string
      /** Miniatura em data URL (imagens), para sobreviver ao reinício do app. */
      thumb?: string
      durationMs?: number
    }
  | { type: 'buttons'; text: string; buttons: ReplyButton[]; pressed?: string }
  | { type: 'list'; text: string; buttonLabel: string; rows: ListRow[] }
  | { type: 'card'; card: ItemCard }

export interface ChatEntry {
  id: string
  /** ISO UTC. */
  at: string
  sender: 'user' | 'agent'
  body: ChatBody
  /**
   * Quando preenchido, a mensagem é entre o Pingo e um contato (não o dono).
   * No simulador mostramos essas mensagens no chat, marcadas, e os botões agem como o contato.
   */
  audience?: { phone: string; name: string }
  /** A mensagem foi escrita no WhatsApp e só está sendo espelhada aqui. */
  via?: 'whatsapp'
}
