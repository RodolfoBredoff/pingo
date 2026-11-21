import type { Channel, Unsubscribe } from '@pingo/core'
import { assertOutgoingValid } from '@pingo/core'
import type { ChannelId, IncomingEvent, MediaRef, OutgoingMessage } from '@pingo/shared'
import type { ChatBody, ChatEntry } from './types'

export interface SimulatorHooks {
  /** Toda mensagem (do usuário ou do agente) que deve aparecer e ser guardada no chat. */
  onEntry(entry: ChatEntry): void
  onTyping(on: boolean): void
  /** Nome do contato para exibir nas mensagens simuladas. */
  contactName(phone: string): string
}

/**
 * Canal do simulador: o "WhatsApp de mentirinha" dentro do app.
 * Usa as mesmas validações do canal real (limites de botões, listas), então o
 * comportamento é idêntico ao que o WhatsApp aceitaria.
 */
export class SimulatorChannel implements Channel {
  readonly id: ChannelId = 'simulator'
  private handlers = new Set<(e: IncomingEvent) => void | Promise<void>>()
  private media = new Map<string, Uint8Array>()

  constructor(
    private readonly ownerPhone: string,
    private readonly now: () => Date,
    private readonly hooks: SimulatorHooks,
  ) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.handlers.clear()
  }

  onEvent(handler: (e: IncomingEvent) => void | Promise<void>): Unsubscribe {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async setTyping(_toPhone: string, on: boolean): Promise<void> {
    this.hooks.onTyping(on)
  }

  async fetchMedia(media: MediaRef): Promise<Uint8Array> {
    const data = this.media.get(media.ref)
    if (!data) throw new Error('Mídia não encontrada no simulador.')
    return data
  }

  /** O agente fala com o usuário. */
  async send(toPhone: string, message: OutgoingMessage): Promise<void> {
    assertOutgoingValid(message)
    const entry = this.entry('agent', toBody(message))
    if (toPhone !== this.ownerPhone) {
      entry.audience = { phone: toPhone, name: this.hooks.contactName(toPhone) }
    }
    this.hooks.onEntry(entry)
  }

  // ---------------------------------------------------------- lado do usuário

  async userText(text: string): Promise<void> {
    this.hooks.onEntry(this.entry('user', { type: 'text', text }))
    await this.emit({
      type: 'message',
      channel: 'simulator',
      channelMsgId: crypto.randomUUID(),
      fromPhone: this.ownerPhone,
      receivedAt: this.now().toISOString(),
      text,
    })
  }

  async userMedia(opts: {
    kind: 'image' | 'pdf' | 'audio'
    mimeType: string
    name: string
    data: Uint8Array
    caption?: string
    thumb?: string
    durationMs?: number
  }): Promise<void> {
    const ref = crypto.randomUUID()
    this.media.set(ref, opts.data)
    this.hooks.onEntry(
      this.entry('user', {
        type: 'attachment',
        kind: opts.kind,
        name: opts.name,
        caption: opts.caption,
        thumb: opts.thumb,
        durationMs: opts.durationMs,
      }),
    )
    await this.emit({
      type: 'message',
      channel: 'simulator',
      channelMsgId: crypto.randomUUID(),
      fromPhone: this.ownerPhone,
      receivedAt: this.now().toISOString(),
      text: opts.caption,
      media: { kind: opts.kind, mimeType: opts.mimeType, sizeBytes: opts.data.length, ref },
    })
  }

  /**
   * Toque num botão. `echoTitle` mostra o título como mensagem do usuário (como no WhatsApp).
   * `asPhone` simula o toque de um contato (por padrão, o dono).
   */
  async userButton(buttonId: string, echoTitle?: string, asPhone?: string): Promise<void> {
    const from = asPhone ?? this.ownerPhone
    if (echoTitle) {
      const echo = this.entry('user', { type: 'text', text: echoTitle })
      if (from !== this.ownerPhone) {
        echo.audience = { phone: from, name: this.hooks.contactName(from) }
      }
      this.hooks.onEntry(echo)
    }
    await this.emit({
      type: 'button',
      channel: 'simulator',
      channelMsgId: crypto.randomUUID(),
      fromPhone: from,
      receivedAt: this.now().toISOString(),
      buttonId,
    })
  }

  private async emit(event: IncomingEvent): Promise<void> {
    for (const h of this.handlers) await h(event)
  }

  private entry(sender: 'user' | 'agent', body: ChatBody): ChatEntry {
    return { id: crypto.randomUUID(), at: this.now().toISOString(), sender, body }
  }
}

function toBody(m: OutgoingMessage): ChatBody {
  switch (m.type) {
    case 'text':
      return { type: 'text', text: m.text }
    case 'buttons':
      return { type: 'buttons', text: m.text, buttons: m.buttons }
    case 'list':
      return { type: 'list', text: m.text, buttonLabel: m.buttonLabel, rows: m.rows }
    case 'card':
      return { type: 'card', card: m.card }
    case 'template':
      // Templates existem só no canal real; no simulador mostramos como texto.
      return { type: 'text', text: `[modelo ${m.name}] ${m.variables.join(' · ')}` }
  }
}
