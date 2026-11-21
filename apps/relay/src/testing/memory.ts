import {
  WaError,
  type Db,
  type DbItem,
  type Deps,
  type Files,
  type Queue,
  type QueuedMessage,
  type ReminderSchedule,
  type Scheduler,
  type SecretName,
  type Secrets,
  type WaMedia,
  type WaPayload,
  type WhatsApp,
} from '../ports'

/** Versões em memória das portas, para testar os handlers sem AWS e sem Meta. */

export class MemoryDb implements Db {
  readonly items = new Map<string, DbItem>()
  private key = (pk: string, sk: string) => `${pk}\u0000${sk}`
  async get(pk: string, sk: string) {
    const v = this.items.get(this.key(pk, sk))
    return v ? structuredClone(v) : undefined
  }
  async put(item: DbItem) {
    this.items.set(this.key(item.pk, item.sk), structuredClone(item))
  }
  async putIfAbsent(item: DbItem) {
    if (this.items.has(this.key(item.pk, item.sk))) return false
    await this.put(item)
    return true
  }
  constructor(_now: () => number = () => Date.now()) {}
  async claimSlot(pk: string, sk: string, nowMs: number, durationMs: number) {
    const cur = this.items.get(this.key(pk, sk))
    if (cur && typeof cur.untilMs === 'number' && cur.untilMs >= nowMs) return false
    await this.put({ pk, sk, untilMs: nowMs + durationMs })
    return true
  }
  async update(pk: string, sk: string, attrs: Record<string, unknown>) {
    const cur = this.items.get(this.key(pk, sk))
    if (cur) this.items.set(this.key(pk, sk), { ...cur, ...structuredClone(attrs) })
  }
  async delete(pk: string, sk: string) {
    this.items.delete(this.key(pk, sk))
  }
  async query(pk: string) {
    return [...this.items.values()].filter((i) => i.pk === pk).map((i) => structuredClone(i))
  }
  async clear() {
    const n = this.items.size
    this.items.clear()
    return n
  }
  count(pk: string) {
    return [...this.items.values()].filter((i) => i.pk === pk).length
  }
}

interface Stored {
  id: string
  body: string
  group: string
  dedup: string
  invisibleUntil: number
  receives: number
}

/** Fila FIFO simplificada: deduplicação, mensagens "em voo" e retorno após o prazo de visibilidade. */
export class MemoryQueue implements Queue {
  readonly all: Stored[] = []
  private seq = 0
  constructor(private readonly now: () => number) {}
  async send(body: string, dedupId: string, groupId: string) {
    if (this.all.some((m) => m.dedup === dedupId)) return
    this.all.push({
      id: `m${++this.seq}`,
      body,
      group: groupId,
      dedup: dedupId,
      invisibleUntil: 0,
      receives: 0,
    })
  }
  async receive(max: number, _wait: number, visibilitySec: number): Promise<QueuedMessage[]> {
    const t = this.now()
    const busyGroups = new Set(this.all.filter((m) => m.invisibleUntil > t).map((m) => m.group))
    const out: QueuedMessage[] = []
    for (const m of this.all) {
      if (out.length >= max) break
      if (m.invisibleUntil > t || busyGroups.has(m.group)) continue
      m.invisibleUntil = t + visibilitySec * 1000
      m.receives++
      out.push({ receipt: `${m.id}:${m.receives}`, body: m.body })
    }
    return out
  }
  async delete(receipts: string[]) {
    let n = 0
    for (const r of receipts) {
      const [id, rcv] = r.split(':')
      const i = this.all.findIndex((m) => m.id === id && String(m.receives) === rcv)
      if (i >= 0) {
        this.all.splice(i, 1)
        n++
      }
    }
    return n
  }
  async purge() {
    this.all.length = 0
  }
}

export class MemorySecrets implements Secrets {
  constructor(readonly values: Partial<Record<SecretName, string>> = {}) {}
  async get(name: SecretName) {
    return this.values[name]
  }
}

export class MemoryFiles implements Files {
  readonly objects = new Map<string, { data: Uint8Array; contentType: string }>()
  async put(key: string, data: Uint8Array, contentType: string) {
    this.objects.set(key, { data, contentType })
  }
  async presignGet(key: string, expiresInSec: number) {
    return `https://files.test/${key}?expires=${expiresInSec}`
  }
  async deleteAll() {
    const n = this.objects.size
    this.objects.clear()
    return n
  }
}

export class MemoryScheduler implements Scheduler {
  readonly schedules = new Map<string, string>()
  async upsert(s: ReminderSchedule) {
    this.schedules.set(s.id, s.at)
  }
  async remove(id: string) {
    this.schedules.delete(id)
  }
  async removeAll() {
    const n = this.schedules.size
    this.schedules.clear()
    return n
  }
}

/** Meta de mentira: guarda o que seria enviado e pode ser configurada para falhar. */
export class FakeWhatsApp implements WhatsApp {
  readonly sent: WaPayload[] = []
  failWith: WaError | null = null
  media = new Map<string, WaMedia>()
  async send(payload: WaPayload) {
    if (this.failWith) throw this.failWith
    this.sent.push(payload)
    return { messageId: `wamid.fake${this.sent.length}` }
  }
  async getMedia(id: string, maxBytes: number) {
    if (this.failWith) throw this.failWith
    const m = this.media.get(id)
    if (!m) throw new WaError(404, 100, 'mídia inexistente')
    if (m.data.length > maxBytes) throw new WaError(413, undefined, 'arquivo grande demais')
    return m
  }
}

export interface Harness {
  deps: Deps
  clock: { now: Date }
  db: MemoryDb
  queue: MemoryQueue
  secrets: MemorySecrets
  files: MemoryFiles
  scheduler: MemoryScheduler
  wa: FakeWhatsApp
  logs: { level: string; msg: string; fields?: Record<string, unknown> }[]
}

export function makeHarness(start = new Date('2026-11-07T21:00:00-03:00')): Harness {
  const clock = { now: start }
  const nowMs = () => clock.now.getTime()
  const logs: Harness['logs'] = []
  const log = (level: string) => (msg: string, fields?: Record<string, unknown>) =>
    void logs.push({ level, msg, fields })
  const db = new MemoryDb(nowMs)
  const queue = new MemoryQueue(nowMs)
  const secrets = new MemorySecrets({
    'app-secret': 'segredo-de-teste-do-app',
    'verify-token': 'token-de-verificacao',
    'access-token': 'token-de-acesso',
    'phone-number-id': '1234567890',
  })
  const files = new MemoryFiles()
  const scheduler = new MemoryScheduler()
  const wa = new FakeWhatsApp()
  const deps: Deps = {
    db,
    queue,
    secrets,
    files,
    scheduler,
    wa,
    clock: () => clock.now,
    log: { info: log('info'), warn: log('warn'), error: log('error') },
  }
  return { deps, clock, db, queue, secrets, files, scheduler, wa, logs }
}
