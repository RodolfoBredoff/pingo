import type { ChannelId, IncomingEvent, MediaRef, OutgoingMessage } from '@pingo/shared'
import type { Channel, Unsubscribe } from '../channel'
import type { Logger } from '../logger'

export interface MultiChannelOptions {
  ownerPhone: string
  /** Chamado para cada mensagem que o dono mandou pelo WhatsApp, para espelhar na conversa do app. */
  mirrorIncoming?: (event: IncomingEvent) => void
  log?: Logger
}

/**
 * Junta o simulador (a conversa dentro do app) e o WhatsApp numa conversa só.
 *
 * - Eventos de qualquer um dos dois chegam ao orquestrador.
 * - O que o Pingo diz ao dono aparece sempre no app. Vai também ao WhatsApp quando a última
 *   mensagem do dono veio de lá, ou quando é um aviso por iniciativa do Pingo (lembrete, oferta),
 *   que traz um modelo de reserva (`fallback`).
 * - Contatos só existem no WhatsApp.
 */
export class MultiChannel implements Channel {
  readonly id: ChannelId = 'whatsapp'
  private lastOwnerVia: 'local' | 'remote' = 'remote'

  constructor(
    private readonly local: Channel,
    private readonly remote: Channel,
    private readonly o: MultiChannelOptions,
  ) {}

  async start(): Promise<void> {
    await this.local.start()
    await this.remote.start()
  }

  async stop(): Promise<void> {
    await this.remote.stop()
    await this.local.stop()
  }

  onEvent(handler: (e: IncomingEvent) => void | Promise<void>): Unsubscribe {
    const wrap = (via: 'local' | 'remote') => (e: IncomingEvent) => {
      if (e.fromPhone === this.o.ownerPhone) {
        this.lastOwnerVia = via
        if (via === 'remote') this.o.mirrorIncoming?.(e)
      }
      return handler(e)
    }
    const offLocal = this.local.onEvent(wrap('local'))
    const offRemote = this.remote.onEvent(wrap('remote'))
    return () => {
      offLocal()
      offRemote()
    }
  }

  async send(toPhone: string, message: OutgoingMessage): Promise<void> {
    if (toPhone !== this.o.ownerPhone) {
      await this.remote.send(toPhone, message)
      return
    }
    await this.local.send(toPhone, message)
    const proactive = 'fallback' in message && !!message.fallback
    if (this.lastOwnerVia === 'remote' || proactive) {
      try {
        await this.remote.send(toPhone, message)
      } catch (e) {
        // O app já mostrou a mensagem; a falha do WhatsApp não deve derrubar o fluxo.
        this.o.log?.warn('mensagem não chegou ao WhatsApp', {
          error: e instanceof Error ? e.name : 'desconhecido',
        })
      }
    }
  }

  fetchMedia(media: MediaRef): Promise<Uint8Array> {
    return media.ref && this.isRemoteRef(media)
      ? this.remote.fetchMedia(media)
      : this.local.fetchMedia(media)
  }

  /** Mídia do simulador usa UUIDs locais; a do WhatsApp usa ids numéricos da Meta. */
  private isRemoteRef(media: MediaRef): boolean {
    return /^\d{5,40}$/.test(media.ref)
  }

  async setTyping(toPhone: string, on: boolean): Promise<void> {
    await this.local.setTyping?.(toPhone, on)
  }
}
