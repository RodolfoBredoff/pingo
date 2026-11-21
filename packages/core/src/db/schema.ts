import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { ChannelId, ItemKind } from '@pingo/shared'

/**
 * Esquema do banco local (design.md §4).
 * Datas em ISO 8601 UTC (texto) para ordenar e comparar sem surpresas.
 */

export type ItemStatus = 'proposed' | 'confirmed' | 'done' | 'cancelled' | 'discarded' | 'expired'
export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled'
export type ContactStatus = 'pending' | 'active' | 'blocked'
export type AssignmentStatus = 'offered' | 'accepted' | 'declined'
export type ConversationState = 'idle' | 'processing' | 'proposal' | 'editing' | 'offering'
export type MissingField = 'when' | 'where' | 'who'
export type AiRole = 'text' | 'vision' | 'pdf' | 'audio'

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** Uma única linha (id = 1): o dono da instalação. */
export const owner = sqliteTable('owner', {
  id: integer('id').primaryKey(),
  phone: text('phone').notNull(),
  name: text('name').notNull(),
  tz: text('tz').notNull().default('America/Sao_Paulo'),
  consentAt: text('consent_at'),
})

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    optInAt: text('opt_in_at'),
    status: text('status').$type<ContactStatus>().notNull().default('pending'),
  },
  (t) => [uniqueIndex('contacts_phone_uq').on(t.phone)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    channel: text('channel').$type<ChannelId>().notNull(),
    direction: text('direction').$type<'in' | 'out'>().notNull(),
    channelMsgId: text('channel_msg_id').notNull(),
    fromPhone: text('from_phone'),
    type: text('type').$type<'text' | 'image' | 'pdf' | 'audio' | 'button'>().notNull(),
    text: text('text'),
    mediaPath: text('media_path'),
    transcript: text('transcript'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('messages_channel_msg_uq').on(t.channel, t.channelMsgId)],
)

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    sourceMessageId: text('source_message_id').references(() => messages.id),
    kind: text('kind').$type<ItemKind>().notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    dueAt: text('due_at'),
    location: text('location'),
    assigneeContactId: text('assignee_contact_id').references(() => contacts.id),
    status: text('status').$type<ItemStatus>().notNull().default('proposed'),
    confidence: real('confidence'),
    missingFields: text('missing_fields', { mode: 'json' }).$type<MissingField[]>(),
    evidence: text('evidence'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('items_status_start_idx').on(t.status, t.startsAt)],
)

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    remindAt: text('remind_at').notNull(),
    status: text('status').$type<ReminderStatus>().notNull().default('pending'),
    deliveredVia: text('delivered_via').$type<'local' | 'cloud'>(),
    cloudScheduleId: text('cloud_schedule_id'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [index('reminders_status_at_idx').on(t.status, t.remindAt)],
)

export const assignments = sqliteTable('assignments', {
  id: text('id').primaryKey(),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  contactId: text('contact_id')
    .notNull()
    .references(() => contacts.id),
  status: text('status').$type<AssignmentStatus>().notNull().default('offered'),
  offeredAt: text('offered_at').notNull(),
  answeredAt: text('answered_at'),
})

/** Uma única linha (id = 1): estado atual da conversa com o dono. */
export const conversationState = sqliteTable('conversation_state', {
  id: integer('id').primaryKey(),
  state: text('state').$type<ConversationState>().notNull().default('idle'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  expiresAt: text('expires_at'),
})

export const usage = sqliteTable(
  'usage',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    role: text('role').$type<AiRole>().notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
  },
  (t) => [index('usage_at_idx').on(t.at)],
)

/**
 * Histórico do chat do SIMULADOR, só para a conversa sobreviver a reinícios do app.
 * O canal WhatsApp não usa esta tabela. Fica local, no dispositivo.
 */
export const chatLog = sqliteTable(
  'chat_log',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    sender: text('sender').$type<'user' | 'agent'>().notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('chat_log_at_idx').on(t.at)],
)
