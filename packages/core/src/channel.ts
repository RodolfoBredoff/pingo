import {
  MAX_BUTTONS,
  MAX_BUTTON_TITLE,
  MAX_LIST_ROWS,
  type ChannelId,
  type IncomingEvent,
  type MediaRef,
  type OutgoingMessage,
} from '@pingo/shared'

export type Unsubscribe = () => void

/**
 * Fronteira entre as regras de negócio e o mundo externo.
 * Implementações: SimulatorChannel (app) e RelayChannel (WhatsApp via AWS).
 * O core NÃO importa nada de Tauri ou AWS: tudo passa por aqui.
 */
export interface Channel {
  readonly id: ChannelId
  start(): Promise<void>
  stop(): Promise<void>
  /** Registra um ouvinte de eventos de entrada. */
  onEvent(handler: (event: IncomingEvent) => void | Promise<void>): Unsubscribe
  send(toPhone: string, message: OutgoingMessage): Promise<void>
  /** Baixa o conteúdo de uma mídia recebida. */
  fetchMedia(media: MediaRef): Promise<Uint8Array>
  /** Opcional: mostra "digitando…" enquanto a IA trabalha (o simulador usa para animar). */
  setTyping?(toPhone: string, on: boolean): Promise<void>
}

/**
 * Valida os limites do WhatsApp antes de enviar.
 * O simulador usa as mesmas regras para o comportamento ser idêntico ao canal real.
 */
export function assertOutgoingValid(message: OutgoingMessage): void {
  if (message.type === 'buttons') {
    assertButtons(message.buttons)
  }
  if (message.type === 'card') {
    assertButtons(message.card.actions)
  }
  if (message.type === 'list' && message.rows.length > MAX_LIST_ROWS) {
    throw new Error(`Lista com ${message.rows.length} linhas; máximo é ${MAX_LIST_ROWS}.`)
  }
}

function assertButtons(buttons: { id: string; title: string }[]): void {
  if (buttons.length > MAX_BUTTONS) {
    throw new Error(`${buttons.length} botões; máximo é ${MAX_BUTTONS}.`)
  }
  for (const b of buttons) {
    if (b.title.length > MAX_BUTTON_TITLE) {
      throw new Error(`Título de botão "${b.title}" passa de ${MAX_BUTTON_TITLE} caracteres.`)
    }
  }
}
