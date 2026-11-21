import type { ChannelId, IncomingEvent, MediaRef, OutgoingMessage } from '@pingo/shared'
import type { Channel, Unsubscribe } from '../channel'

/**
 * Canal em memória: guarda o que o agente enviou e permite injetar eventos.
 * Serve para scripts e verificações; o simulador visual (Fase 2) é outra implementação.
 */
export class MemoryChannel implements Channel {
  readonly id: ChannelId = 'simulator'
  readonly sent: { toPhone: string; message: OutgoingMessage }[] = []
  private handlers = new Set<(e: IncomingEvent) => void | Promise<void>>()
  private media = new Map<string, Uint8Array>()

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.handlers.clear()
  }

  onEvent(handler: (e: IncomingEvent) => void | Promise<void>): Unsubscribe {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async send(toPhone: string, message: OutgoingMessage): Promise<void> {
    this.sent.push({ toPhone, message })
  }

  async fetchMedia(media: MediaRef): Promise<Uint8Array> {
    const data = this.media.get(media.ref)
    if (!data) throw new Error(`mídia não encontrada: ${media.ref}`)
    return data
  }

  /** Registra bytes de mídia para o evento que será injetado. */
  putMedia(ref: string, data: Uint8Array): void {
    this.media.set(ref, data)
  }

  /** Injeta um evento como se viesse do usuário e espera os ouvintes terminarem. */
  async emit(event: IncomingEvent): Promise<void> {
    for (const h of this.handlers) await h(event)
  }

  /** Remove e devolve o que foi enviado até agora. */
  drain(): { toPhone: string; message: OutgoingMessage }[] {
    return this.sent.splice(0, this.sent.length)
  }
}
