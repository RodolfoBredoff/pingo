import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import type {
  IncomingButtonPress,
  IncomingEvent,
  IncomingMessage,
  OutgoingMessage,
} from '@pingo/shared'
import { ExtractionFailedError, MediaTooLargeError, type Extractor } from '../ai/extractor'
import type { Route } from '../ai/extraction-schema'
import { MAX_MEDIA_BYTES, type MediaInput } from '../ai/content'
import { assertOutgoingValid, type Channel, type Unsubscribe } from '../channel'
import type { PingoDb } from '../db/client'
import {
  assignments,
  contacts,
  conversationState,
  items,
  messages,
  reminders,
  type ConversationState,
} from '../db/schema'
import { dayHeading, formatAgenda, itemRows, listItems, queryAgenda } from '../domain/agenda'
import { addContact, findContactByName, listContacts, removeContact } from '../domain/contacts'
import {
  applyPatch,
  buildItemCard,
  extractedToRow,
  toLocalSnapshot,
  type ContactRow,
  type ItemRow,
} from '../domain/items'
import {
  addDays,
  cancelReminders,
  itemTiming,
  relativeWhen,
  scheduleReminders,
} from '../domain/reminders'
import type { Logger } from '../logger'
import { formatWhen, localDate, localToUtcIso } from '../time'
import { BudgetExceededError, assertWithinBudget, type BudgetLimits } from '../usage'
import { looksLikeQuery, parseCommand, type Command } from './commands'

/** Propostas sem resposta expiram em 48 h (R3.4). */
export const PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000
/** Propostas expiradas há até 7 dias ainda podem ser reabertas com "pendentes". */
const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_REMINDER_ATTEMPTS = 3

export interface OwnerInfo {
  phone: string
  name: string
  tz: string
}

/** Notificação do sistema (desktop/celular). Quem implementa é o app. */
export interface Notifier {
  notify(title: string, body: string): void | Promise<void>
}

export interface OrchestratorDeps {
  db: PingoDb
  channel: Channel
  extractor: Extractor
  owner: OwnerInfo
  /** Tetos padrão de custo (os do usuário, em `settings`, têm prioridade). */
  budget: BudgetLimits
  clock?: () => Date
  log?: Logger
  notifier?: Notifier
  /** De quanto em quanto tempo checar lembretes. 0 desliga (scripts). Padrão: 15 s. */
  reminderIntervalMs?: number
  /**
   * Chamado depois que o dono confirma "apagar meus dados". Quem implementa apaga banco, cofre,
   * mídia e nuvem. Sem isso, o comando só orienta a usar o app.
   */
  onEraseRequested?: () => Promise<void>
}

type StatePayload = {
  itemIds?: string[]
  editingItemId?: string
}

/** Quanto tempo o botão "Sim, apagar tudo" continua valendo. */
const ERASE_CONFIRM_MS = 2 * 60 * 1000

const CANCEL_WORDS = new Set(['cancelar', 'cancela', 'deixa', 'deixa pra la', 'nada', 'esquece'])

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()

const HELP = `Eu organizo seus recados. 💛

• Me mande texto, print, PDF ou áudio e eu monto o cartão.
• *hoje*, *amanhã*, *semana*: sua agenda
• *pendentes*: o que espera a sua confirmação
• *feito dentista* ou *cancelar dentista*
• *contatos* e *adiciona Renato 11 98888-7777*
• *apagar meus dados*: some com tudo deste aparelho
• Pode perguntar: "o que tenho sexta?"`

/**
 * Máquina de estados da conversa (design.md §8): mensagem → extração → proposta → confirmar.
 * Também responde a comandos e perguntas, trata contatos e dispara lembretes.
 * Tudo roda em fila: um evento por vez, em ordem.
 */
export class Orchestrator {
  private readonly clock: () => Date
  private queue: Promise<unknown> = Promise.resolve()
  private unsubscribe: Unsubscribe | null = null
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly d: OrchestratorDeps) {
    this.clock = d.clock ?? (() => new Date())
  }

  async start(): Promise<void> {
    this.unsubscribe = this.d.channel.onEvent((e) => this.handle(e))
    await this.d.channel.start()
    await this.expireStale()
    const every = this.d.reminderIntervalMs ?? 15_000
    if (every > 0) {
      this.timer = setInterval(() => void this.tickReminders(), every)
      void this.tickReminders()
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    this.unsubscribe?.()
    await this.d.channel.stop()
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Processa um evento e só retorna quando terminar (útil em scripts). */
  handle(event: IncomingEvent): Promise<void> {
    return this.enqueue(() => this.dispatch(event))
  }

  /** Marca como "expired" as propostas paradas há mais de 48 h (R3.4). */
  async expireStale(): Promise<number> {
    const cutoff = new Date(this.clock().getTime() - PROPOSAL_TTL_MS).toISOString()
    const stale = await this.d.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.status, 'proposed'), lt(items.createdAt, cutoff)))
    if (stale.length === 0) return 0
    await this.d.db
      .update(items)
      .set({ status: 'expired', updatedAt: this.clock().toISOString() })
      .where(
        inArray(
          items.id,
          stale.map((s) => s.id),
        ),
      )
    return stale.length
  }

  // ---------------------------------------------------------------- despacho

  private async dispatch(event: IncomingEvent): Promise<void> {
    const mine = event.fromPhone === this.d.owner.phone
    try {
      const messageId = await this.recordIncoming(event)
      if (!messageId) return // já processada (idempotência, R1.4)
      if (!mine) await this.onContactEvent(event)
      else if (event.type === 'button') await this.onButton(event)
      else await this.onMessage(event, messageId)
    } catch (e) {
      this.d.log?.error('falha ao processar evento', {
        error: e instanceof Error ? e.name : 'desconhecido',
      })
      if (mine) {
        // Se nem o aviso de erro conseguir sair (sem internet, por exemplo), não há mais o que fazer.
        await this.say(
          'Ops, algo deu errado do meu lado. Sua mensagem ficou guardada, tente de novo em instantes. 🙏',
        ).catch(() => undefined)
      }
    } finally {
      await this.d.channel.setTyping?.(this.d.owner.phone, false)
    }
  }

  /** Guarda a mensagem. Devolve null se o canal já a entregou antes. */
  private async recordIncoming(event: IncomingEvent): Promise<string | null> {
    const dup = await this.d.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.channel, event.channel), eq(messages.channelMsgId, event.channelMsgId)),
      )
      .get()
    if (dup) return null
    const id = crypto.randomUUID()
    await this.d.db.insert(messages).values({
      id,
      channel: event.channel,
      direction: 'in',
      channelMsgId: event.channelMsgId,
      fromPhone: event.fromPhone,
      type: event.type === 'button' ? 'button' : event.media ? event.media.kind : 'text',
      // Para botões guardamos só o identificador (não é conteúdo pessoal).
      text: event.type === 'button' ? event.buttonId : (event.text ?? null),
      createdAt: event.receivedAt,
    })
    return id
  }

  // ---------------------------------------------------------------- mensagens

  private async onMessage(msg: IncomingMessage, messageId: string): Promise<void> {
    const db = this.d.db
    const state = await this.getState()
    if (state.state === 'editing' && state.payload.editingItemId && msg.text && !msg.media) {
      await this.applyEdit(state.payload.editingItemId, msg.text)
      return
    }

    // Vídeo, figurinha, localização…: não sei ler, mas aviso em vez de ficar em silêncio (R1.1).
    if (msg.unsupportedType) {
      await this.say(
        'Ainda não sei ler esse tipo de mensagem. Pode mandar texto, imagem, PDF ou áudio? 🙂',
      )
      return
    }

    // Comandos exatos não gastam IA.
    if (msg.text && !msg.media) {
      const cmd = parseCommand(msg.text)
      if (cmd) {
        await this.runCommand(cmd)
        return
      }
    }

    try {
      await assertWithinBudget(db, this.clock(), this.d.owner.tz, this.d.budget)
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        await this.say(
          `Cheguei no teto de uso da IA (${e.scope === 'daily' ? 'do dia' : 'do mês'}). Guardei sua mensagem; ajuste o limite nas configurações ou tente mais tarde.`,
        )
        return
      }
      throw e
    }

    await this.d.channel.setTyping?.(this.d.owner.phone, true)

    // Pergunta sobre a agenda? Só vale gastar uma chamada se o texto parece pergunta.
    if (msg.text && !msg.media && looksLikeQuery(msg.text)) {
      try {
        const { route } = await this.d.extractor.route({
          text: msg.text,
          now: this.clock(),
          tz: this.d.owner.tz,
        })
        if (route.intent === 'query') {
          await this.answerRoute(route)
          return
        }
      } catch (e) {
        if (!(e instanceof ExtractionFailedError)) throw e
        // Falha ao classificar: trata como recado comum.
      }
    }

    let media: MediaInput | undefined
    if (msg.media) {
      if (msg.media.sizeBytes > MAX_MEDIA_BYTES) {
        await this.say('Esse arquivo passa do limite de 10 MB. Pode mandar uma versão menor?')
        return
      }
      const data = await this.d.channel.fetchMedia(msg.media)
      media = { kind: msg.media.kind, mimeType: msg.media.mimeType, data }
    }

    let result
    try {
      result = await this.d.extractor.extract({
        text: msg.text,
        media,
        now: this.clock(),
        tz: this.d.owner.tz,
      })
    } catch (e) {
      if (e instanceof MediaTooLargeError) {
        await this.say('Esse arquivo passa do limite de 10 MB. Pode mandar uma versão menor?')
        return
      }
      if (e instanceof ExtractionFailedError) {
        await this.say(
          'Não consegui entender essa mensagem agora. Ela ficou guardada; tente de novo em instantes. 🙏',
        )
        return
      }
      throw e
    }

    const { extraction } = result
    if (extraction.transcript) {
      await db
        .update(messages)
        .set({ transcript: extraction.transcript })
        .where(eq(messages.id, messageId))
    }
    if (!extraction.actionable || extraction.items.length === 0) {
      await this.say(
        'Li com atenção e não achei nada para organizar aqui. Se quiser, me diga o que fazer com isso. 🙂',
      )
      await this.setState('idle', {})
      return
    }

    const contactRows = await db.select().from(contacts)
    const rows: ItemRow[] = []
    for (const it of extraction.items) {
      const row = extractedToRow(it, {
        id: crypto.randomUUID(),
        tz: this.d.owner.tz,
        now: this.clock(),
        sourceMessageId: messageId,
        contacts: contactRows,
      })
      await db.insert(items).values(row)
      rows.push((await this.getItem(row.id!))!)
    }
    await this.presentProposals(
      rows,
      rows.length === 1
        ? 'Entendi assim. Confere pra mim:'
        : `Encontrei ${rows.length} coisas nessa mensagem. Confere pra mim:`,
    )
  }

  private async presentProposals(rows: ItemRow[], intro: string): Promise<void> {
    const contactRows = await this.d.db.select().from(contacts)
    await this.say(intro)
    for (const r of rows) {
      await this.send({ type: 'card', card: buildItemCard(r, this.d.owner.tz, contactRows) })
    }
    if (rows.length > 1) {
      await this.send({
        type: 'buttons',
        text: 'Quer resolver tudo de uma vez?',
        buttons: [
          { id: 'confirm_all', title: 'Confirmar todos' },
          { id: 'discard_all', title: 'Descartar todos' },
        ],
      })
    }
    await this.setState('proposal', { itemIds: rows.map((r) => r.id) })
  }

  // ----------------------------------------------------------------- comandos

  private async runCommand(cmd: Command): Promise<void> {
    const tz = this.d.owner.tz
    const today = localDate(this.clock(), tz)
    switch (cmd.type) {
      case 'range': {
        const from = cmd.range === 'tomorrow' ? addDays(today, 1) : today
        const to =
          cmd.range === 'today' ? today : cmd.range === 'tomorrow' ? from : addDays(today, 6)
        const title =
          cmd.range === 'today'
            ? '📅 *Hoje*'
            : cmd.range === 'tomorrow'
              ? '📅 *Amanhã*'
              : '📅 *Próximos 7 dias*'
        await this.answerAgenda(
          { from, to, scope: 'agenda', keyword: null },
          title,
          cmd.range === 'today',
        )
        return
      }
      case 'pending':
        await this.showPending()
        return
      case 'erase':
        if (!this.d.onEraseRequested) {
          await this.say('Para apagar tudo, use Ajustes → Privacidade e dados, no app.')
          return
        }
        await this.send({
          type: 'buttons',
          text: 'Isso apaga *tudo* deste aparelho: agenda, contatos, conversa e histórico. Não dá para desfazer. Tem certeza?',
          buttons: [
            { id: `erase_yes:${this.clock().getTime()}`, title: 'Sim, apagar tudo' },
            { id: 'erase_no', title: 'Não, manter' },
          ],
        })
        return
      case 'help':
        await this.say(HELP)
        return
      case 'contacts': {
        const all = await listContacts(this.d.db)
        await this.say(
          all.length === 0
            ? 'Você ainda não tem contatos. Escreva, por exemplo: *adiciona Renato 11 98888-7777*.'
            : `*Seus contatos*\n${all.map((c) => `• ${c.name} · ${c.phone}${c.status === 'active' ? ' ✅' : ' (aguardando aceite)'}`).join('\n')}`,
        )
        return
      }
      case 'add_contact': {
        const r = await addContact(this.d.db, cmd.name, cmd.phone)
        if (r.ok) {
          await this.say(
            `Anotei *${r.contact.name}* (${r.contact.phone}). 👍 Antes de mandar qualquer coisa, eu peço permissão a ele(a).`,
          )
        } else {
          await this.say(
            r.error === 'duplicate'
              ? 'Esse telefone já está nos seus contatos.'
              : r.error === 'phone'
                ? 'Não entendi esse telefone. Use o DDD, por exemplo: *adiciona Renato 11 98888-7777*.'
                : 'Qual é o nome do contato?',
          )
        }
        return
      }
      case 'remove_contact': {
        const c = findContactByName(await listContacts(this.d.db), cmd.name)
        if (!c) {
          await this.say(`Não achei "${cmd.name}" nos seus contatos.`)
          return
        }
        await removeContact(this.d.db, c.id)
        await this.say(`Removi *${c.name}* dos contatos.`)
        return
      }
      case 'done':
      case 'cancel': {
        const found = await this.findConfirmedByText(cmd.ref)
        if (found.length === 0) {
          await this.say(`Não achei nada na sua agenda com "${cmd.ref}".`)
        } else if (found.length > 1) {
          await this.send({
            type: 'list',
            text: `Achei ${found.length} itens com "${cmd.ref}". Qual deles?`,
            buttonLabel: 'Escolher item',
            rows: itemRows(found, tz),
          })
        } else if (cmd.type === 'done') {
          await this.completeItem(found[0]!)
        } else {
          await this.cancelItem(found[0]!)
        }
        return
      }
    }
  }

  private async findConfirmedByText(ref: string): Promise<ItemRow[]> {
    const needle = normalize(ref)
    if (!needle) return []
    const rows = await listItems(this.d.db, ['confirmed'])
    return rows.filter((r) => normalize(`${r.title} ${r.location ?? ''}`).includes(needle))
  }

  private async answerRoute(route: Route): Promise<void> {
    const tz = this.d.owner.tz
    const today = localDate(this.clock(), tz)
    const from = route.from && /^\d{4}-\d{2}-\d{2}$/.test(route.from) ? route.from : today
    const to = route.to && /^\d{4}-\d{2}-\d{2}$/.test(route.to) ? route.to : addDays(from, 14)
    if (route.scope === 'pending') {
      await this.showPending()
      return
    }
    await this.answerAgenda(
      { from, to: to < from ? from : to, scope: route.scope, keyword: route.keyword },
      route.keyword ? `🔎 *${route.keyword}*` : '📅 *Encontrei isto*',
      false,
    )
  }

  private async answerAgenda(
    q: {
      from: string
      to: string
      scope: 'agenda' | 'pending' | 'done' | 'all'
      keyword: string | null
    },
    title: string,
    withOverdue: boolean,
  ): Promise<void> {
    const tz = this.d.owner.tz
    const today = localDate(this.clock(), tz)
    const res = await queryAgenda(this.d.db, { ...q, tz }, today)
    if (!withOverdue) res.overdue = []
    // "undated" só aparece quando a pessoa buscou um tema específico.
    if (!q.keyword) res.undated = []
    const all = [...res.overdue, ...res.inRange, ...res.undated]
    if (all.length === 0) {
      const label =
        q.from === q.to ? dayHeading(q.from, today).split(' · ')[0]!.toLowerCase() : 'esse período'
      await this.say(`Nada marcado para ${label}. 🌤️`)
      return
    }
    await this.say(formatAgenda(res, tz, today, title))
    await this.send({
      type: 'list',
      text: 'Quer mexer em algum item?',
      buttonLabel: 'Abrir um item',
      rows: itemRows(all, tz),
    })
  }

  private async showPending(): Promise<void> {
    const now = this.clock()
    const cutoff = new Date(now.getTime() - REOPEN_WINDOW_MS).toISOString()
    const open = await this.d.db
      .select()
      .from(items)
      .where(inArray(items.status, ['proposed', 'expired']))
      .orderBy(asc(items.createdAt))
    const rows = open.filter((r) => r.status === 'proposed' || r.updatedAt >= cutoff).slice(0, 5)
    if (rows.length === 0) {
      await this.say('Nenhuma proposta esperando você. 🎉')
      return
    }
    for (const r of rows.filter((x) => x.status === 'expired')) {
      // Reabrir: volta a ser proposta e ganha mais 48 h.
      await this.d.db
        .update(items)
        .set({ status: 'proposed', createdAt: now.toISOString(), updatedAt: now.toISOString() })
        .where(eq(items.id, r.id))
    }
    const fresh = (await Promise.all(rows.map((r) => this.getItem(r.id)))).filter(
      (r): r is ItemRow => !!r,
    )
    await this.presentProposals(
      fresh,
      fresh.length === 1
        ? 'Tem 1 proposta esperando você:'
        : `Tem ${fresh.length} propostas esperando você:`,
    )
  }

  // ------------------------------------------------------------------ botões

  private async onButton(evt: IncomingButtonPress): Promise<void> {
    const [action, a, b] = evt.buttonId.split(':') as [
      string,
      string | undefined,
      string | undefined,
    ]
    const state = await this.getState()

    if (action === 'confirm_all' || action === 'discard_all') {
      let done = 0
      for (const id of state.payload.itemIds ?? []) {
        const item = await this.getItem(id)
        if (item?.status !== 'proposed') continue
        if (action === 'confirm_all') await this.confirmItem(item, false)
        else await this.setItemStatus(id, 'discarded')
        done++
      }
      await this.say(
        done === 0
          ? 'Esses itens já foram tratados.'
          : action === 'confirm_all'
            ? `Pronto! ${done} itens na sua agenda. ✅`
            : `Descartei ${done} itens.`,
      )
      await this.setState('idle', {})
      return
    }

    if (action === 'erase_no') {
      await this.say('Ok, não apaguei nada. 🙂')
      return
    }
    if (action === 'erase_yes') {
      const asked = Number(a)
      if (!this.d.onEraseRequested || !Number.isFinite(asked)) return
      if (this.clock().getTime() - asked > ERASE_CONFIRM_MS) {
        await this.say(
          'Esse pedido de apagar já venceu. Se ainda quiser, escreva *apagar meus dados* de novo.',
        )
        return
      }
      await this.d.onEraseRequested()
      return
    }

    if (!a) return
    // Nos botões de adiamento, `a` é o id do lembrete, não do item.
    if (action === 'rem_snooze1h' || action === 'rem_snoozetm') {
      await this.snooze(a, action === 'rem_snooze1h' ? '1h' : 'tomorrow')
      return
    }
    const item = await this.getItem(a)
    if (!item) {
      await this.say('Não encontrei esse item.')
      return
    }

    switch (action) {
      case 'confirm':
      case 'discard':
      case 'edit': {
        if (item.status !== 'proposed') {
          await this.say('Esse item já foi tratado.')
          return
        }
        if (action === 'confirm') {
          await this.confirmItem(item, true)
          await this.afterResolve(item.id)
        } else if (action === 'discard') {
          await this.setItemStatus(item.id, 'discarded')
          await this.say(`Descartei "${item.title}".`)
          await this.afterResolve(item.id)
        } else {
          await this.setState('editing', { ...state.payload, editingItemId: item.id })
          await this.say(
            `O que você quer mudar em "${item.title}"? Escreva do seu jeito (ex.: "muda para 14h", "local: escola", "é para o Renato"). Para desistir, diga "cancelar".`,
          )
        }
        return
      }
      case 'item':
        await this.showItemActions(item)
        return
      case 'done':
        await this.completeItem(item)
        return
      case 'cancel_item':
        await this.cancelItem(item)
        return
      case 'assign_pick':
        await this.pickContact(item)
        return
      case 'assign': {
        const contact = (await listContacts(this.d.db)).find((c) => c.id === b)
        if (!contact) {
          await this.say('Não achei esse contato.')
          return
        }
        await this.assignTo(item, contact)
        return
      }
      case 'rem_done':
        await this.completeItem(item)
        return
    }
  }

  private async afterResolve(resolvedId: string): Promise<void> {
    const state = await this.getState()
    const remaining: string[] = []
    for (const id of state.payload.itemIds ?? []) {
      if (id === resolvedId) continue
      if ((await this.getItem(id))?.status === 'proposed') remaining.push(id)
    }
    await this.setState(
      remaining.length ? 'proposal' : 'idle',
      remaining.length ? { itemIds: remaining } : {},
    )
  }

  // ------------------------------------------------------ confirmar e concluir

  private async confirmItem(item: ItemRow, announce: boolean): Promise<void> {
    const tz = this.d.owner.tz
    await this.setItemStatus(item.id, 'confirmed')
    const updated = (await this.getItem(item.id))!
    const times = await scheduleReminders(this.d.db, updated, tz, this.clock())
    if (!announce) {
      if (updated.assigneeContactId) await this.offerIfContact(updated)
      return
    }

    const lines = [`Pronto! "${item.title}" está na sua agenda. ✅`]
    if (times.length) {
      lines.push(
        `🔔 Te aviso ${times.map((t) => relativeWhen(t, false, tz, this.clock())).join(' e ')}.`,
      )
    }
    const offered = updated.assigneeContactId ? await this.offerIfContact(updated) : null
    if (offered) lines.push(`📨 Pedi para ${offered.name} aceitar.`)

    const hasContacts = (await listContacts(this.d.db)).length > 0
    if (hasContacts && !updated.assigneeContactId) {
      await this.send({
        type: 'buttons',
        text: lines.join('\n'),
        buttons: [{ id: `assign_pick:${item.id}`, title: 'Passar para…' }],
      })
    } else {
      await this.say(lines.join('\n'))
    }
  }

  private async completeItem(item: ItemRow): Promise<void> {
    if (item.status !== 'confirmed') {
      await this.say(
        item.status === 'done'
          ? 'Esse item já estava feito. ✔️'
          : 'Esse item não está na sua agenda.',
      )
      return
    }
    await this.setItemStatus(item.id, 'done')
    await cancelReminders(this.d.db, item.id)
    await this.say(`Feito! 🎉 "${item.title}" saiu da sua lista.`)
  }

  private async cancelItem(item: ItemRow): Promise<void> {
    if (item.status !== 'confirmed' && item.status !== 'proposed') {
      await this.say('Esse item não está ativo.')
      return
    }
    await this.setItemStatus(item.id, 'cancelled')
    await cancelReminders(this.d.db, item.id)
    await this.say(`Cancelei "${item.title}".`)
    await this.tellAssignee(
      item,
      `O item *${item.title}* foi cancelado. Pode ficar tranquilo(a). 🙂`,
    )
  }

  private async showItemActions(item: ItemRow): Promise<void> {
    const tz = this.d.owner.tz
    const ref = item.startsAt ?? item.dueAt
    const when = ref
      ? `${item.startsAt ? '' : 'até '}${formatWhen(ref, tz, item.allDay)}`
      : 'sem data'
    const text = `*${item.title}*\n${when}${item.location ? `\n📍 ${item.location}` : ''}`
    if (item.status !== 'confirmed') {
      await this.say(`${text}\n(${item.status === 'proposed' ? 'aguardando você' : item.status})`)
      return
    }
    await this.send({
      type: 'buttons',
      text,
      buttons: [
        { id: `done:${item.id}`, title: 'Feito ✅' },
        { id: `cancel_item:${item.id}`, title: 'Cancelar item' },
      ],
    })
  }

  // ----------------------------------------------------------------- contatos

  private async pickContact(item: ItemRow): Promise<void> {
    const all = await listContacts(this.d.db)
    if (all.length === 0) {
      await this.say(
        'Você ainda não tem contatos. Escreva, por exemplo: *adiciona Renato 11 98888-7777*.',
      )
      return
    }
    await this.send({
      type: 'list',
      text: `Para quem você quer passar "${item.title}"?`,
      buttonLabel: 'Escolher contato',
      rows: all.slice(0, 10).map((c) => ({
        id: `assign:${item.id}:${c.id}`,
        title: c.name.slice(0, 24),
        description: c.phone,
      })),
    })
  }

  private async assignTo(item: ItemRow, contact: ContactRow): Promise<void> {
    if (item.status !== 'confirmed') {
      await this.say('Só dá para passar itens que já estão na agenda.')
      return
    }
    await this.d.db
      .update(items)
      .set({ assigneeContactId: contact.id, updatedAt: this.clock().toISOString() })
      .where(eq(items.id, item.id))
    await this.offerToContact((await this.getItem(item.id))!, contact)
    await this.say(
      `📨 Pedi para ${contact.name} ficar com "${item.title}". Te aviso quando responder.`,
    )
  }

  private async offerIfContact(item: ItemRow): Promise<ContactRow | null> {
    const contact = (await listContacts(this.d.db)).find((c) => c.id === item.assigneeContactId)
    if (!contact) return null
    await this.offerToContact(item, contact)
    return contact
  }

  /** Pede ao contato que aceite o item. A primeira mensagem também serve de opt-in (R6.3). */
  private async offerToContact(item: ItemRow, contact: ContactRow): Promise<void> {
    const tz = this.d.owner.tz
    const id = crypto.randomUUID()
    await this.d.db.insert(assignments).values({
      id,
      itemId: item.id,
      contactId: contact.id,
      status: 'offered',
      offeredAt: this.clock().toISOString(),
    })
    const ref = item.startsAt ?? item.dueAt
    const when = ref
      ? `${item.startsAt ? '' : 'até '}${formatWhen(ref, tz, item.allDay)}`
      : 'sem data'
    const intro =
      contact.status === 'active'
        ? `Oi, ${contact.name}! É o Pingo de novo. 💛`
        : `Oi, ${contact.name}! Aqui é o Pingo, assistente de ${this.d.owner.name}. 💛 Posso te mandar recados e lembretes?`
    await this.d.channel.send(contact.phone, {
      type: 'buttons',
      text: `${intro}\n${this.d.owner.name} quer passar para você:\n*${item.title}*\n${when}${item.location ? `\n📍 ${item.location}` : ''}\n\nPode ficar com essa?`,
      buttons: [
        { id: `offer_yes:${id}`, title: 'Aceito' },
        { id: `offer_no:${id}`, title: 'Não posso' },
      ],
      // Fora da janela de 24 h (contato novo), o WhatsApp só aceita o modelo aprovado.
      fallback: {
        type: 'template',
        name: 'oferta_responsabilidade',
        variables: [
          contact.name,
          this.d.owner.name,
          item.title,
          `${when}${item.location ? ` · ${item.location}` : ''}`,
        ],
        buttonPayloads: [`offer_yes:${id}`, `offer_no:${id}`],
      },
    })
  }

  private async onContactEvent(event: IncomingEvent): Promise<void> {
    const contact = (await listContacts(this.d.db)).find((c) => c.phone === event.fromPhone)
    if (!contact) {
      // Número desconhecido: ignorado em silêncio (R6.3).
      this.d.log?.info('evento de número desconhecido ignorado', { channel: event.channel })
      return
    }
    if (event.type !== 'button') {
      await this.d.channel.send(contact.phone, {
        type: 'text',
        text: 'Oi! Eu só respondo pelos botões das mensagens que mando. 🙂',
      })
      return
    }
    const [action, assignmentId] = event.buttonId.split(':') as [string, string | undefined]
    if (!assignmentId || (action !== 'offer_yes' && action !== 'offer_no')) return

    const asg = await this.d.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .get()
    if (!asg || asg.contactId !== contact.id || asg.status !== 'offered') {
      await this.d.channel.send(contact.phone, { type: 'text', text: 'Essa já foi respondida. 👍' })
      return
    }
    const item = await this.getItem(asg.itemId)
    const nowIso = this.clock().toISOString()

    if (action === 'offer_yes') {
      await this.d.db
        .update(assignments)
        .set({ status: 'accepted', answeredAt: nowIso })
        .where(eq(assignments.id, asg.id))
      await this.d.db
        .update(contacts)
        .set({ status: 'active', optInAt: contact.optInAt ?? nowIso })
        .where(eq(contacts.id, contact.id))
      await this.d.channel.send(contact.phone, {
        type: 'text',
        text: `Combinado! Te lembro quando chegar a hora. ✅`,
      })
      await this.say(`✅ ${contact.name} aceitou${item ? ` "${item.title}"` : ''}.`)
    } else {
      await this.d.db
        .update(assignments)
        .set({ status: 'declined', answeredAt: nowIso })
        .where(eq(assignments.id, asg.id))
      if (item?.assigneeContactId === contact.id) {
        await this.d.db
          .update(items)
          .set({ assigneeContactId: null, updatedAt: nowIso })
          .where(eq(items.id, item.id))
      }
      await this.d.channel.send(contact.phone, {
        type: 'text',
        text: 'Sem problema, avisei por aqui. 🙂',
      })
      await this.say(
        `${contact.name} não pode ficar com${item ? ` "${item.title}"` : ' esse item'}. Ele continua com você.`,
      )
    }
  }

  private async acceptedContact(itemId: string): Promise<ContactRow | null> {
    const asg = await this.d.db
      .select()
      .from(assignments)
      .where(and(eq(assignments.itemId, itemId), eq(assignments.status, 'accepted')))
      .get()
    if (!asg) return null
    return (await listContacts(this.d.db)).find((c) => c.id === asg.contactId) ?? null
  }

  private async tellAssignee(item: ItemRow, text: string): Promise<void> {
    try {
      const c = await this.acceptedContact(item.id)
      if (c) await this.d.channel.send(c.phone, { type: 'text', text })
    } catch (e) {
      // Avisar o contato é cortesia (fora da janela de 24 h o WhatsApp recusa texto livre).
      this.d.log?.warn('aviso ao contato não enviado', {
        error: e instanceof Error ? e.name : 'desconhecido',
      })
    }
  }

  // --------------------------------------------------------------- lembretes

  /** Dispara os lembretes vencidos. Chamado por um relógio interno e pelo painel de dev. */
  tickReminders(): Promise<number> {
    return this.enqueue(() => this.doTick()).catch((e) => {
      this.d.log?.error('falha no ciclo de lembretes', {
        error: e instanceof Error ? e.name : 'desconhecido',
      })
      return 0
    })
  }

  private async doTick(): Promise<number> {
    const tz = this.d.owner.tz
    const now = this.clock()
    const due = await this.d.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, 'pending'),
          lt(reminders.remindAt, new Date(now.getTime() + 1).toISOString()),
        ),
      )
      .orderBy(asc(reminders.remindAt))
      .limit(20)

    let sent = 0
    for (const r of due) {
      const item = await this.getItem(r.itemId)
      const timing = item ? itemTiming(item) : null
      // Item que saiu da agenda, ou cujo momento já passou: o lembrete perdeu o sentido.
      if (!item || item.status !== 'confirmed' || (timing && timing.expiresAt < now.getTime())) {
        await this.d.db.update(reminders).set({ status: 'cancelled' }).where(eq(reminders.id, r.id))
        continue
      }

      const ref = item.startsAt ?? item.dueAt
      const when = ref
        ? `${item.startsAt ? '' : 'até '}${relativeWhen(ref, item.allDay, tz, now)}`
        : ''
      const body = `🔔 *${item.title}*\n${when}${item.location ? ` · 📍${item.location}` : ''}`
      try {
        await this.send({
          type: 'buttons',
          text: body,
          buttons: [
            { id: `rem_done:${item.id}`, title: 'Feito ✅' },
            { id: `rem_snooze1h:${r.id}`, title: 'Adiar 1 h' },
            { id: `rem_snoozetm:${r.id}`, title: 'Amanhã 9h' },
          ],
          // Lembrete é por iniciativa do Pingo: quase sempre cai fora da janela de 24 h.
          fallback: {
            type: 'template',
            name: 'lembrete_item',
            variables: [
              item.title,
              `${when || 'em breve'}${item.location ? ` · ${item.location}` : ''}`,
            ],
            buttonPayloads: [`rem_done:${item.id}`, `rem_snooze1h:${r.id}`, `rem_snoozetm:${r.id}`],
          },
        })
        // O contato que aceitou também é avisado, mas a falha dele nunca refaz o aviso do dono.
        try {
          const c = await this.acceptedContact(item.id)
          if (c) {
            await this.d.channel.send(c.phone, {
              type: 'text',
              text: `${body}\n(${this.d.owner.name} passou isso para você)`,
              fallback: {
                type: 'template',
                name: 'lembrete_contato',
                variables: [item.title, when || 'em breve', this.d.owner.name],
              },
            })
          }
        } catch (e) {
          this.d.log?.warn('lembrete ao contato não enviado', {
            error: e instanceof Error ? e.name : 'desconhecido',
          })
        }
        await this.d.notifier?.notify(item.title, when || 'Lembrete')
        await this.d.db
          .update(reminders)
          .set({ status: 'sent', deliveredVia: 'local', attempts: r.attempts + 1 })
          .where(eq(reminders.id, r.id))
        sent++
      } catch (e) {
        const attempts = r.attempts + 1
        await this.d.db
          .update(reminders)
          .set({ attempts, status: attempts >= MAX_REMINDER_ATTEMPTS ? 'failed' : 'pending' })
          .where(eq(reminders.id, r.id))
        this.d.log?.warn('lembrete não enviado', {
          attempts,
          error: e instanceof Error ? e.name : 'desconhecido',
        })
      }
    }
    return sent
  }

  private async snooze(reminderId: string, mode: '1h' | 'tomorrow'): Promise<void> {
    const rem = await this.d.db.select().from(reminders).where(eq(reminders.id, reminderId)).get()
    const item = rem ? await this.getItem(rem.itemId) : undefined
    if (!rem || !item || item.status !== 'confirmed') {
      await this.say('Esse item já não está ativo.')
      return
    }
    const now = this.clock()
    const tz = this.d.owner.tz
    const at =
      mode === '1h'
        ? new Date(now.getTime() + 60 * 60_000).toISOString()
        : localToUtcIso(`${addDays(localDate(now, tz), 1)}T09:00:00`, tz)!
    await this.d.db
      .insert(reminders)
      .values({ id: crypto.randomUUID(), itemId: item.id, remindAt: at })
    await this.say(
      mode === '1h'
        ? 'Ok, te lembro daqui a 1 h. ⏰'
        : `Ok, te lembro ${relativeWhen(at, false, tz, now)}. ⏰`,
    )
  }

  // ------------------------------------------------------------------ edição

  private async applyEdit(itemId: string, instruction: string): Promise<void> {
    const item = await this.getItem(itemId)
    const state = await this.getState()
    const back = { itemIds: state.payload.itemIds }
    if (!item || item.status !== 'proposed') {
      await this.say('Esse item já foi tratado.')
      await this.setState('idle', {})
      return
    }
    if (CANCEL_WORDS.has(normalize(instruction))) {
      await this.say('Ok, sem mudanças.')
      await this.setState('proposal', back)
      return
    }

    await this.d.channel.setTyping?.(this.d.owner.phone, true)
    const contactRows = await this.d.db.select().from(contacts)
    let patchResult
    try {
      patchResult = await this.d.extractor.patch({
        itemJson: JSON.stringify(toLocalSnapshot(item, this.d.owner.tz, contactRows)),
        instruction,
        now: this.clock(),
        tz: this.d.owner.tz,
      })
    } catch (e) {
      if (e instanceof ExtractionFailedError) {
        await this.say(
          'Não consegui aplicar essa mudança. Tente descrever de outro jeito, ou diga "cancelar".',
        )
        return // continua em "editing"
      }
      throw e
    }

    const { changes, unmatchedAssignee } = applyPatch(item, patchResult.patch, {
      tz: this.d.owner.tz,
      now: this.clock(),
      contacts: contactRows,
    })
    await this.d.db.update(items).set(changes).where(eq(items.id, itemId))
    const updated = (await this.getItem(itemId))!

    if (unmatchedAssignee) {
      await this.say(
        `Não achei "${unmatchedAssignee}" nos seus contatos, então mantive o responsável como estava. Para cadastrar: *adiciona ${unmatchedAssignee} 11 98888-7777*.`,
      )
    }
    await this.say('Atualizei. Agora está assim:')
    await this.send({ type: 'card', card: buildItemCard(updated, this.d.owner.tz, contactRows) })
    await this.setState('proposal', back)
  }

  // ----------------------------------------------------------------- apoio

  private async getItem(id: string): Promise<ItemRow | undefined> {
    return this.d.db.select().from(items).where(eq(items.id, id)).get()
  }

  private async setItemStatus(id: string, status: ItemRow['status']): Promise<void> {
    await this.d.db
      .update(items)
      .set({ status, updatedAt: this.clock().toISOString() })
      .where(eq(items.id, id))
  }

  private async getState(): Promise<{ state: ConversationState; payload: StatePayload }> {
    const row = await this.d.db
      .select()
      .from(conversationState)
      .where(eq(conversationState.id, 1))
      .get()
    if (!row) return { state: 'idle', payload: {} }
    return { state: row.state, payload: (row.payload ?? {}) as StatePayload }
  }

  private async setState(state: ConversationState, payload: StatePayload): Promise<void> {
    const expiresAt = new Date(this.clock().getTime() + PROPOSAL_TTL_MS).toISOString()
    await this.d.db
      .insert(conversationState)
      .values({ id: 1, state, payload, expiresAt })
      .onConflictDoUpdate({ target: conversationState.id, set: { state, payload, expiresAt } })
  }

  private say(text: string): Promise<void> {
    return this.send({ type: 'text', text })
  }

  private async send(message: OutgoingMessage): Promise<void> {
    assertOutgoingValid(message)
    await this.d.channel.send(this.d.owner.phone, message)
  }
}
