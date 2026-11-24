import type {
  AckRequest,
  AllowlistRequest,
  ChannelId,
  IncomingEvent,
  InboxResponse,
  MediaRef,
  MediaResponse,
  OutboxRequest,
  OutboxResponse,
  OutgoingMessage,
  PairResponse,
  RelayErrorBody,
  RelayErrorCode,
} from '@pingo/shared'
import { MAX_MEDIA_BYTES } from '../ai/content'
import type { Channel, Unsubscribe } from '../channel'
import type { Logger } from '../logger'
import { toWire } from './wire'

export type RelayStatus = 'stopped' | 'connecting' | 'online' | 'offline' | 'unauthorized'

/** Erro devolvido pelo relay (ou falha de rede, com `code` = "network"). */
export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: RelayErrorCode | 'network',
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'RelayError'
  }
}

export interface RelayChannelOptions {
  /** Ex.: https://abc123.execute-api.sa-east-1.amazonaws.com */
  baseUrl: string
  /** Lido a cada chamada: assim parear ou despareiar vale na hora, sem reiniciar. */
  getToken: () => Promise<string | null>
  /** No app, o fetch do Tauri (sem CORS). Nos testes, um fetch falso. */
  fetchFn?: typeof fetch
  /** Quanto o relay segura cada consulta à espera de mensagens (máx. 20 s). */
  pollWaitSec?: number
  /** Pausa entre consultas quando `pollWaitSec` é 0 (testes). */
  idleDelayMs?: number
  onStatus?: (s: RelayStatus) => void
  log?: Logger
  /** Para testes: troca o relógio de espera. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const REQUEST_TIMEOUT_MS = 35_000
const MAX_BACKOFF_MS = 60_000

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })

function trimUrl(u: string): string {
  return u.replace(/\/+$/, '')
}

/** Aborta quando o tempo acaba ou quando `outer` abortar. Sem AbortSignal.any/timeout (WebViews antigos). */
function withTimeout(ms: number, outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  const onOuter = () => ctl.abort()
  if (outer?.aborted) ctl.abort()
  else outer?.addEventListener('abort', onOuter, { once: true })
  return {
    signal: ctl.signal,
    done: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuter)
    },
  }
}

async function request<T>(
  fetchFn: typeof fetch,
  baseUrl: string,
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const t = withTimeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS, opts.signal)
  let res: Response
  let text: string
  try {
    res = await fetchFn(`${trimUrl(baseUrl)}${path}`, {
      method,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: t.signal,
    })
    text = await res.text()
  } catch {
    throw new RelayError(0, 'network')
  } finally {
    t.done()
  }
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  if (!res.ok) {
    const e = json as Partial<RelayErrorBody>
    throw new RelayError(res.status, e.error ?? 'internal', e.detail)
  }
  return json as T
}

/** Troca o código de pareamento (de `pnpm relay:pair-code`) pelo token do dispositivo. */
export async function pairRelay(opts: {
  baseUrl: string
  code: string
  fetchFn?: typeof fetch
}): Promise<string> {
  const r = await request<PairResponse>(
    opts.fetchFn ?? fetch,
    opts.baseUrl,
    'POST',
    '/device/pair',
    {
      body: { code: opts.code },
      timeoutMs: 15_000,
    },
  )
  return r.token
}

/**
 * Canal WhatsApp via relay na AWS: recebe por long polling e envia pela rota /outbox.
 * Só confirma (ack) uma mensagem depois que o app terminou de tratá-la; se o app cair no meio,
 * a mensagem volta à fila depois de 2 minutos.
 */
export class RelayChannel implements Channel {
  readonly id: ChannelId = 'whatsapp'
  private handlers = new Set<(e: IncomingEvent) => void | Promise<void>>()
  private abort: AbortController | null = null
  private statusNow: RelayStatus = 'stopped'
  private readonly fetchFn: typeof fetch
  private readonly sleep: (ms: number, s: AbortSignal) => Promise<void>

  constructor(private readonly o: RelayChannelOptions) {
    this.fetchFn = o.fetchFn ?? fetch
    this.sleep = o.sleep ?? defaultSleep
  }

  get status(): RelayStatus {
    return this.statusNow
  }

  private setStatus(s: RelayStatus) {
    if (s === this.statusNow) return
    this.statusNow = s
    this.o.onStatus?.(s)
  }

  onEvent(handler: (e: IncomingEvent) => void | Promise<void>): Unsubscribe {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  async start(): Promise<void> {
    if (this.abort) return
    this.abort = new AbortController()
    this.setStatus('connecting')
    void this.loop(this.abort)
  }

  async stop(): Promise<void> {
    this.abort?.abort()
    this.abort = null
    this.handlers.clear()
    this.setStatus('stopped')
  }

  // ----------------------------------------------------------------- recebimento

  private async loop(ctl: AbortController): Promise<void> {
    let backoff = 1000
    const wait = Math.min(20, Math.max(0, this.o.pollWaitSec ?? 20))
    while (!ctl.signal.aborted) {
      try {
        const token = await this.o.getToken()
        if (!token) {
          this.setStatus('unauthorized')
          return
        }
        const r = await request<InboxResponse>(
          this.fetchFn,
          this.o.baseUrl,
          'GET',
          `/inbox?wait=${wait}&max=10`,
          { token, signal: ctl.signal },
        )
        if (ctl.signal.aborted) return
        this.setStatus('online')
        backoff = 1000
        const receipts: string[] = []
        for (const item of r.messages) {
          await this.dispatch(item.event)
          receipts.push(item.receipt)
        }
        if (receipts.length) {
          const body: AckRequest = { receipts }
          await request(this.fetchFn, this.o.baseUrl, 'POST', '/inbox/ack', { token, body })
        }
        if (wait === 0) await this.sleep(this.o.idleDelayMs ?? 1000, ctl.signal)
      } catch (e) {
        if (ctl.signal.aborted) return
        if (e instanceof RelayError && e.status === 401) {
          this.setStatus('unauthorized')
          return
        }
        this.setStatus('offline')
        this.o.log?.warn('relay indisponível; tentando de novo', {
          code: e instanceof RelayError ? e.code : 'desconhecido',
          status: e instanceof RelayError ? e.status : 0,
        })
        await this.sleep(backoff, ctl.signal)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
  }

  private async dispatch(event: IncomingEvent): Promise<void> {
    for (const h of this.handlers) {
      try {
        await h(event)
      } catch {
        // O orquestrador já registra e avisa o dono. Aqui o evento conta como tratado:
        // reentregar só o faria ser descartado como duplicado.
        this.o.log?.error('falha ao tratar mensagem recebida')
      }
    }
  }

  // ---------------------------------------------------------------------- envio

  async send(toPhone: string, message: OutgoingMessage): Promise<void> {
    const token = await this.requireToken()
    const { parts, fallback } = toWire(message)
    for (let i = 0; i < parts.length; i++) {
      const body: OutboxRequest = {
        to: toPhone,
        message: parts[i]!,
        ...(i === 0 && fallback ? { fallback } : {}),
      }
      const r = await request<OutboxResponse>(this.fetchFn, this.o.baseUrl, 'POST', '/outbox', {
        token,
        body,
      })
      // Se a principal foi como modelo, a janela está fechada: as partes extras não cabem.
      if (r.via === 'template') break
    }
  }

  async fetchMedia(media: MediaRef): Promise<Uint8Array> {
    const token = await this.requireToken()
    const info = await request<MediaResponse>(
      this.fetchFn,
      this.o.baseUrl,
      'GET',
      `/media/${encodeURIComponent(media.ref)}`,
      { token, timeoutMs: 30_000 },
    )
    const t = withTimeout(30_000)
    let data: Uint8Array
    try {
      // Link pré-assinado do S3: não leva o token do relay.
      const res = await this.fetchFn(info.url, { signal: t.signal })
      if (!res.ok) throw new RelayError(res.status, 'internal', 'download da mídia')
      data = new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      if (e instanceof RelayError) throw e
      throw new RelayError(0, 'network')
    } finally {
      t.done()
    }
    if (data.length > MAX_MEDIA_BYTES) throw new RelayError(413, 'too_large')
    return data
  }

  // ----------------------------------------------------------------- administração

  /** Atualiza no relay quem pode falar com o Pingo: o dono e os contatos cadastrados. */
  async syncAllowlist(owner: string, contacts: string[]): Promise<void> {
    const token = await this.requireToken()
    const body: AllowlistRequest = { owner, contacts }
    await request(this.fetchFn, this.o.baseUrl, 'PUT', '/allowlist', { token, body })
  }

  /** "Apagar meus dados" na nuvem: fila, mídia, lembretes e registros. */
  async eraseRemote(): Promise<void> {
    const token = await this.requireToken()
    await request(this.fetchFn, this.o.baseUrl, 'DELETE', '/me', { token, timeoutMs: 30_000 })
  }

  /** Cria ou troca um lembrete na nuvem (usado quando o app estiver fechado). */
  async putReminder(
    id: string,
    body: {
      at: string
      to: string
      message: OutboxRequest['message']
      fallback?: OutboxRequest['fallback']
    },
  ): Promise<void> {
    const token = await this.requireToken()
    await request(this.fetchFn, this.o.baseUrl, 'PUT', `/reminders/${encodeURIComponent(id)}`, {
      token,
      body,
    })
  }

  async deleteReminder(id: string): Promise<void> {
    const token = await this.requireToken()
    await request(this.fetchFn, this.o.baseUrl, 'DELETE', `/reminders/${encodeURIComponent(id)}`, {
      token,
    })
  }

  private async requireToken(): Promise<string> {
    const t = await this.o.getToken()
    if (!t) throw new RelayError(401, 'unauthorized', 'dispositivo não pareado')
    return t
  }
}
