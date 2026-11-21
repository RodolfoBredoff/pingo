import type { IncomingEvent } from '@pingo/shared'

/**
 * Portas do relay: tudo que toca a AWS ou a Meta passa por aqui.
 * Os handlers só conhecem estas interfaces, então rodam iguais com AWS de verdade
 * (src/aws) ou com a versão em memória usada nos testes (src/testing).
 */

export interface DbItem {
  pk: string
  sk: string
  /** Epoch em segundos; o DynamoDB apaga o item algum tempo depois (não é exato). */
  ttl?: number
  [attr: string]: unknown
}

export interface Db {
  get(pk: string, sk: string): Promise<DbItem | undefined>
  put(item: DbItem): Promise<void>
  /** Grava só se ainda não existe. Devolve false se já existia. */
  putIfAbsent(item: DbItem): Promise<boolean>
  /**
   * Reserva uma vaga com prazo: grava se não existe ou se a anterior já venceu.
   * Serve para "no máximo 1 aviso a cada 10 minutos".
   */
  claimSlot(pk: string, sk: string, nowMs: number, durationMs: number): Promise<boolean>
  /** Altera só estes campos de um item que já existe. Não faz nada se ele não existir. */
  update(pk: string, sk: string, attrs: Record<string, unknown>): Promise<void>
  delete(pk: string, sk: string): Promise<void>
  query(pk: string): Promise<DbItem[]>
  /** Apaga todos os itens de todas as partições conhecidas. Devolve quantos. */
  clear(): Promise<number>
}

export interface QueuedMessage {
  receipt: string
  body: string
}

export interface Queue {
  send(body: string, dedupId: string, groupId: string): Promise<void>
  receive(max: number, waitSec: number, visibilitySec: number): Promise<QueuedMessage[]>
  delete(receipts: string[]): Promise<number>
  purge(): Promise<void>
}

export type SecretName = 'app-secret' | 'access-token' | 'phone-number-id' | 'verify-token'

export interface Secrets {
  /** Devolve undefined se ainda não foi configurado. */
  get(name: SecretName): Promise<string | undefined>
}

export interface Files {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>
  presignGet(key: string, expiresInSec: number): Promise<string>
  deleteAll(): Promise<number>
}

export interface ReminderSchedule {
  id: string
  /** ISO UTC. */
  at: string
}

export interface Scheduler {
  upsert(s: ReminderSchedule): Promise<void>
  remove(id: string): Promise<void>
  removeAll(): Promise<number>
}

/** Corpo já no formato da API de mensagens da Meta. */
export type WaPayload = Record<string, unknown>

export class WaError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'WaError'
  }
  /** Vale tentar de novo (erro do servidor ou limite de taxa). */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429
  }
}

export interface WaMedia {
  data: Uint8Array
  mimeType: string
}

export interface WhatsApp {
  send(payload: WaPayload): Promise<{ messageId: string }>
  /** Baixa uma mídia recebida. Recusa arquivos acima de `maxBytes`. */
  getMedia(mediaId: string, maxBytes: number): Promise<WaMedia>
}

export interface Deps {
  db: Db
  queue: Queue
  secrets: Secrets
  files: Files
  scheduler: Scheduler
  wa: WhatsApp
  clock: () => Date
  log: Logger
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

export type { IncomingEvent }
