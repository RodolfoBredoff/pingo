import { invoke } from '@tauri-apps/api/core'
import { asc, eq } from 'drizzle-orm'
import {
  addContact,
  BACKUP_FILE_PATTERN,
  BackupInvalidError,
  backupFileName,
  CONSENT_SETTING,
  CONSENT_VERSION,
  eraseAllData,
  exportBackup,
  importBackup,
  listContacts,
  normalizePhone,
  Orchestrator,
  parseBackup,
  parseCommand,
  removeContact,
  serializeBackup,
  createLogger,
  itemStatuses,
  listItems,
  loadModelsConfig,
  schema,
  spentSince,
  startOfLocalDayUtc,
  startOfLocalMonthUtc,
  type Backup,
  type Notifier,
  type PingoDb,
} from '@pingo/core'
import { join } from '@tauri-apps/api/path'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readDir, readTextFile, remove as removeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import type { ChatBody, ChatEntry } from '../chat/types'
import { SimulatorChannel } from '../chat/simulator-channel'
import { openDatabase } from '../db/tauri-db'
import { secrets } from '../db/secrets'
import { makeThumb, toWav } from '../lib/audio'
import { LazyExtractor } from './lazy-extractor'
import { getApp, goTab, setApp, showToast, type ThemeMode } from './store'

const log = createLogger({ scope: 'app' })
const MAX_FILE = 10 * 1024 * 1024
const OWNER_PHONE = '+5500000000000' // número fictício do dono no simulador

interface Runtime {
  channel: SimulatorChannel
  orchestrator: Orchestrator
  owner: { phone: string; name: string; tz: string }
  /** ms somados ao relógio real (viagem no tempo do painel de desenvolvedor). */
  offsetMs: number
}

let db: PingoDb
let rt: Runtime | null = null
let initPromise: Promise<void> | null = null
let housekeeping: ReturnType<typeof setInterval> | undefined
let backupTimer: ReturnType<typeof setInterval> | undefined

const now = () => new Date(Date.now() + (rt?.offsetMs ?? getApp().clockOffsetMs))

// ------------------------------------------------------------------ configurações

async function getSetting(key: string): Promise<string | undefined> {
  return (await db.select().from(schema.settings).where(eq(schema.settings.key, key)).get())?.value
}
async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
}

export function applyTheme(mode: ThemeMode) {
  const el = document.documentElement
  if (mode === 'auto') delete el.dataset.theme
  else el.dataset.theme = mode
}
export function applyReduceMotion(on: boolean) {
  document.documentElement.dataset.reduceMotion = on ? 'on' : 'off'
}

export async function setThemeMode(mode: ThemeMode) {
  setApp({ theme: mode })
  applyTheme(mode)
  await setSetting('theme', mode)
}
export async function setReduceMotion(on: boolean) {
  setApp({ reduceMotion: on })
  applyReduceMotion(on)
  await setSetting('reduce_motion', on ? '1' : '0')
}

// ------------------------------------------------------------------------ boot

export function initApp(): Promise<void> {
  initPromise ??= (async () => {
    try {
      if (import.meta.env.DEV) {
        // Só em desenvolvimento: copia a chave do .env.local para o keychain, se ainda não houver.
        await invoke('dev_seed_openrouter_key').catch(() => undefined)
      }
      db = (await openDatabase()).db

      const theme = ((await getSetting('theme')) ?? 'auto') as ThemeMode
      const reduce = (await getSetting('reduce_motion')) === '1'
      setApp({ theme, reduceMotion: reduce })
      applyTheme(theme)
      applyReduceMotion(reduce)

      setApp({ hasKey: !!(await secrets.get('openrouter_api_key')) })

      const owner = await db.select().from(schema.owner).where(eq(schema.owner.id, 1)).get()
      if (!owner) {
        setApp({ phase: 'onboarding' })
        return
      }
      // Quem já usava antes do texto de consentimento (ou quando ele muda) precisa aceitar de novo.
      if ((await getSetting(CONSENT_SETTING)) !== CONSENT_VERSION) {
        setApp({ phase: 'consent', ownerName: owner.name })
        return
      }
      setApp({ consentAt: owner.consentAt })
      await startRuntime(owner.name, owner.phone, owner.tz)
    } catch (e) {
      log.error('falha ao iniciar', { error: String(e) })
      setApp({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  })()
  return initPromise
}

/** Telefone digitado no cadastro: vazio é aceito (só será necessário ao ligar o WhatsApp). */
export function parseOwnerPhone(raw: string): { ok: true; phone: string | null } | { ok: false } {
  if (!raw.trim()) return { ok: true, phone: null }
  const phone = normalizePhone(raw)
  return phone ? { ok: true, phone } : { ok: false }
}

/** Só é chamado depois que a pessoa aceitou o texto de consentimento na tela. */
export async function completeOnboarding(name: string, rawPhone = '') {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  const clean = name.trim().slice(0, 40) || 'você'
  const parsed = parseOwnerPhone(rawPhone)
  const phone = parsed.ok && parsed.phone ? parsed.phone : OWNER_PHONE
  const consentAt = new Date().toISOString()
  await db
    .insert(schema.owner)
    .values({ id: 1, phone, name: clean, tz, consentAt })
    .onConflictDoNothing()
  await setSetting(CONSENT_SETTING, CONSENT_VERSION)
  setApp({ consentAt })
  await startRuntime(clean, phone, tz)
}

/** Dono que já existia: registra o aceite do texto atual e segue para o app. */
export async function acceptConsent() {
  const owner = await db.select().from(schema.owner).where(eq(schema.owner.id, 1)).get()
  if (!owner) return
  const consentAt = new Date().toISOString()
  await db.update(schema.owner).set({ consentAt }).where(eq(schema.owner.id, 1))
  await setSetting(CONSENT_SETTING, CONSENT_VERSION)
  setApp({ consentAt })
  await startRuntime(owner.name, owner.phone, owner.tz)
}

async function startRuntime(name: string, phone: string, tz: string) {
  const config = loadModelsConfig()
  const channel = new SimulatorChannel(phone, now, {
    onEntry: (e) => addEntry(e),
    onTyping: (on) => setApp({ typing: on }),
    contactName: (p) => getApp().contacts.find((c) => c.phone === p)?.name ?? p,
  })
  const extractor = new LazyExtractor(db, now, (r) =>
    setApp({
      lastRun: {
        at: now().toISOString(),
        role: r.role,
        model: r.model,
        json: JSON.stringify(r.json, null, 2),
      },
    }),
  )
  const orchestrator = new Orchestrator({
    db,
    channel,
    extractor,
    owner: { phone, name, tz },
    budget: config.limits,
    clock: now,
    log: log.child('orchestrator'),
    notifier: systemNotifier,
    // "apagar meus dados" pelo chat, depois da confirmação por botão.
    onEraseRequested: () => eraseEverything({ removeKey: false }),
  })
  rt = { channel, orchestrator, owner: { phone, name, tz }, offsetMs: 0 }
  setApp({ contacts: await listContacts(db) })
  await orchestrator.start()
  void prepareNotifications()
  void refreshAutostart()
  void startBackupScheduler()
  // Faxina leve: propostas paradas expiram e a tela acompanha.
  clearInterval(housekeeping)
  housekeeping = setInterval(() => {
    void orchestrator
      .expireStale()
      .then((n) => (n > 0 ? refreshAll() : undefined))
      .catch(() => undefined)
  }, 60_000)

  const rows = await db.select().from(schema.chatLog).orderBy(asc(schema.chatLog.at)).limit(400)
  const entries: ChatEntry[] = rows.map((r) => ({
    id: r.id,
    at: r.at,
    sender: r.sender,
    body: r.payload as unknown as ChatBody,
  }))
  setApp({ entries, ownerName: name, phase: 'ready' })
  await refreshAll()

  if (entries.length === 0) await greet()
}

/** Notificação do sistema para lembretes. Só título e horário; nunca o texto da mensagem original. */
const systemNotifier: Notifier = {
  async notify(title, body) {
    try {
      if (await isPermissionGranted()) sendNotification({ title, body })
    } catch (e) {
      log.warn('notificação não enviada', { error: String(e) })
    }
  },
}

async function prepareNotifications() {
  try {
    if (!(await isPermissionGranted())) await requestPermission()
  } catch {
    /* sem suporte neste ambiente: os lembretes seguem pelo chat */
  }
}

async function greet() {
  const name = rt!.owner.name
  await rt!.channel.send(rt!.owner.phone, {
    type: 'text',
    text: `Oi, ${name}! Eu sou o Pingo. 👋 Me manda um recado, um convite, um print, um PDF ou um áudio, e eu organizo tudo pra você.`,
  })
}

// ------------------------------------------------------------------ histórico

function addEntry(entry: ChatEntry) {
  setApp((s) => ({ entries: [...s.entries, entry] }))
  void db
    .insert(schema.chatLog)
    .values({
      id: entry.id,
      at: entry.at,
      sender: entry.sender,
      payload: entry.body as unknown as Record<string, unknown>,
    })
    .catch((e) => log.warn('não consegui gravar o histórico', { error: String(e) }))
}

export async function refreshAll() {
  const { entries } = getApp()
  const ids = entries.flatMap((e) => (e.body.type === 'card' ? [e.body.card.itemId] : []))
  const [statuses, agenda, contacts] = await Promise.all([
    itemStatuses(db, ids),
    listItems(db, ['proposed', 'confirmed', 'done']),
    listContacts(db),
  ])
  setApp({ statuses, agenda, contacts })
  await refreshSpend()
}

export async function refreshSpend() {
  if (!rt) return
  const n = now()
  const tz = rt.owner.tz
  const [today, month] = await Promise.all([
    spentSince(db, startOfLocalDayUtc(n, tz)),
    spentSince(db, startOfLocalMonthUtc(n, tz)),
  ])
  setApp({ spend: { today, month } })
}

// -------------------------------------------------------------- ações do chat

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const r = await fn()
    await refreshAll()
    return r
  } catch (e) {
    log.error('ação falhou', { error: e instanceof Error ? e.message : String(e) })
    showToast('Algo deu errado. Tente de novo.', 'error')
    await refreshAll().catch(() => undefined)
    return undefined
  }
}

/** Sem chave não há IA: leva a pessoa para Ajustes em vez de falhar em silêncio. */
function ensureKey(): boolean {
  if (getApp().hasKey) return true
  showToast('Falta a chave do OpenRouter. Configure em Ajustes.', 'warn')
  goTab('settings')
  return false
}

export const sendText = async (text: string) => {
  // Comandos exatos ("hoje", "feito dentista"…) funcionam sem chave e sem gastar IA.
  if (parseCommand(text) || ensureKey()) await run(() => rt!.channel.userText(text))
}

export async function sendFile(file: File, caption?: string) {
  if (!ensureKey()) return
  if (file.size > MAX_FILE) {
    showToast('Esse arquivo passa de 10 MB.', 'warn')
    return
  }
  const type = file.type || ''
  const kind = type.startsWith('image/')
    ? 'image'
    : type === 'application/pdf'
      ? 'pdf'
      : type.startsWith('audio/')
        ? 'audio'
        : null
  if (!kind) {
    showToast('Só aceito imagem, PDF ou áudio.', 'warn')
    return
  }
  let data: Uint8Array = new Uint8Array(await file.arrayBuffer())
  let mimeType = type
  if (kind === 'audio') {
    try {
      data = await toWav(file)
      mimeType = 'audio/wav'
    } catch {
      /* mantém o original se o navegador não decodificar */
    }
  }
  const thumb = kind === 'image' ? await makeThumb(file) : undefined
  await run(() => rt!.channel.userMedia({ kind, mimeType, name: file.name, data, caption, thumb }))
}

export async function sendRecording(blob: Blob, durationMs: number) {
  if (!ensureKey()) return
  try {
    const data = await toWav(blob)
    if (data.length > MAX_FILE) {
      showToast('Áudio longo demais (limite de 10 MB).', 'warn')
      return
    }
    await run(() =>
      rt!.channel.userMedia({
        kind: 'audio',
        mimeType: 'audio/wav',
        name: 'Áudio',
        data,
        durationMs,
      }),
    )
  } catch {
    showToast('Não consegui processar o áudio gravado.', 'error')
  }
}

/** Botões do cartão (Confirmar / Editar / Descartar): não ecoam como mensagem. */
export async function pressCard(buttonId: string) {
  const [action, itemId] = buttonId.split(':')
  if (itemId && (action === 'confirm' || action === 'discard')) {
    // Otimista: o cartão já anima enquanto o núcleo confirma no banco.
    setApp((s) => ({
      statuses: { ...s.statuses, [itemId]: action === 'confirm' ? 'confirmed' : 'discarded' },
    }))
  }
  await run(() => rt!.channel.userButton(buttonId))
}

/** Botões de resposta rápida de uma mensagem ("Confirmar todos" etc.). */
export async function pressReply(
  entryId: string,
  buttonId: string,
  title: string,
  asPhone?: string,
) {
  setApp((s) => ({
    entries: s.entries.map((e) =>
      e.id === entryId && e.body.type === 'buttons'
        ? { ...e, body: { ...e.body, pressed: buttonId } }
        : e,
    ),
  }))
  const entry = getApp().entries.find((e) => e.id === entryId)
  if (entry) {
    void db
      .update(schema.chatLog)
      .set({ payload: entry.body as unknown as Record<string, unknown> })
      .where(eq(schema.chatLog.id, entryId))
  }
  await run(() => rt!.channel.userButton(buttonId, title, asPhone))
}

/** Toque numa linha de lista (ex.: escolher um item ou um contato). */
export async function pressListRow(buttonId: string, title: string) {
  await run(() => rt!.channel.userButton(buttonId, title))
}

/** Ação vinda da aba Agenda (Feito / Cancelar): o Pingo responde na conversa. */
export async function agendaAction(action: 'done' | 'cancel_item', itemId: string) {
  await run(() => rt!.channel.userButton(`${action}:${itemId}`))
}

// --------------------------------------------------------------------- contatos

export type ContactResult = { ok: true } | { ok: false; message: string }

export async function addContactUi(name: string, phone: string): Promise<ContactResult> {
  if (rt && normalizePhone(phone) === rt.owner.phone) {
    return { ok: false, message: 'Esse é o seu próprio número.' }
  }
  const r = await addContact(db, name, phone)
  if (!r.ok) {
    const message =
      r.error === 'duplicate'
        ? 'Esse telefone já está nos contatos.'
        : r.error === 'phone'
          ? 'Telefone inválido. Use o DDD, por exemplo 11 98888-7777.'
          : 'Escreva o nome do contato.'
    return { ok: false, message }
  }
  await refreshAll()
  showToast(`${r.contact.name} adicionado.`)
  return { ok: true }
}

export async function removeContactUi(id: string) {
  const c = getApp().contacts.find((x) => x.id === id)
  if (!c) return
  await removeContact(db, c.id)
  await refreshAll()
  showToast(`${c.name} removido.`, 'warn')
}

// ------------------------------------------------------- iniciar com o sistema

async function refreshAutostart() {
  try {
    setApp({ autostart: await isEnabled() })
  } catch {
    setApp({ autostart: null })
  }
}

export async function setAutostart(on: boolean) {
  try {
    if (on) await enable()
    else await disable()
    setApp({ autostart: on })
  } catch {
    showToast('Não consegui mudar essa opção neste sistema.', 'error')
  }
}

// ------------------------------------------------------------ privacidade e backup

const BACKUP_KEEP = 7
const BACKUP_FILTER = [{ name: 'Backup do Pingo', extensions: ['json'] }]

/** Conteúdo do arquivo de backup (também usado pelo autoteste, sem tocar em disco). */
export async function buildBackupText(): Promise<string> {
  return serializeBackup(await exportBackup(db))
}

async function writeBackupTo(path: string): Promise<void> {
  await writeTextFile(path, await buildBackupText())
}

export async function loadBackupState() {
  const [dir, auto, days, lastAt, lastError] = await Promise.all([
    getSetting('backup_dir'),
    getSetting('backup_auto'),
    getSetting('backup_days'),
    getSetting('backup_last_at'),
    getSetting('backup_last_error'),
  ])
  setApp((s) => ({
    backup: {
      ...s.backup,
      dir: dir ?? null,
      auto: auto === '1',
      everyDays: days === '7' ? 7 : 1,
      lastAt: lastAt ?? null,
      lastError: lastError || null,
    },
  }))
}

/** "Exportar backup": a pessoa escolhe onde salvar. */
export async function exportBackupFile(): Promise<void> {
  try {
    const tz = rt?.owner.tz ?? 'America/Sao_Paulo'
    const path = await saveDialog({
      title: 'Salvar backup do Pingo',
      defaultPath: backupFileName(new Date(), tz),
      filters: BACKUP_FILTER,
    })
    if (!path) return
    await writeBackupTo(path)
    showToast('Backup salvo.')
  } catch (e) {
    log.error('falha ao exportar', { error: String(e) })
    showToast('Não consegui salvar o backup.', 'error')
  }
}

export interface ImportPreview {
  exportedAt: string
  items: number
  contacts: number
  messages: number
}

let pendingImport: Backup | null = null

/** Escolhe e valida um arquivo. Não muda nada até `applyImport`. Devolve null se cancelou. */
export async function pickBackupToImport(): Promise<ImportPreview | { error: string } | null> {
  try {
    const path = await openDialog({
      title: 'Escolher backup do Pingo',
      multiple: false,
      directory: false,
      filters: BACKUP_FILTER,
    })
    if (!path || Array.isArray(path)) return null
    pendingImport = parseBackup(await readTextFile(path))
    const t = pendingImport.tables
    return {
      exportedAt: pendingImport.exportedAt,
      items: t.items.length,
      contacts: t.contacts.length,
      messages: t.messages.length,
    }
  } catch (e) {
    pendingImport = null
    if (e instanceof BackupInvalidError) return { error: e.message }
    log.error('falha ao ler backup', { error: String(e) })
    return { error: 'Não consegui abrir esse arquivo.' }
  }
}

export function discardPendingImport() {
  pendingImport = null
}

/** Troca os dados atuais pelos do backup escolhido e reinicia a tela. */
export async function applyImport(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!pendingImport) return { ok: false, message: 'Nenhum backup escolhido.' }
  try {
    await rt?.orchestrator.stop()
    await importBackup(db, pendingImport)
    pendingImport = null
    location.reload()
    return { ok: true }
  } catch (e) {
    log.error('falha ao importar', { error: String(e) })
    // O núcleo já restaurou os dados anteriores; só religa o app.
    location.reload()
    return { ok: false, message: 'A importação falhou e seus dados anteriores foram mantidos.' }
  }
}

export async function chooseBackupDir(): Promise<void> {
  const dir = await openDialog({
    title: 'Pasta para os backups automáticos',
    directory: true,
    multiple: false,
    recursive: true,
  })
  if (!dir || Array.isArray(dir)) return
  await setSetting('backup_dir', dir)
  await setSetting('backup_last_error', '')
  await loadBackupState()
  if (getApp().backup.auto) await runBackupIfDue(true)
}

export async function setBackupAuto(on: boolean) {
  await setSetting('backup_auto', on ? '1' : '0')
  await loadBackupState()
  if (on && !getApp().backup.dir) await chooseBackupDir()
  else if (on) await runBackupIfDue(true)
}

export async function setBackupEvery(days: 1 | 7) {
  await setSetting('backup_days', String(days))
  await loadBackupState()
}

/** Faz o backup automático se estiver na hora (ou se `force`). Mantém só os 7 mais recentes. */
export async function runBackupIfDue(force = false): Promise<boolean> {
  const b = getApp().backup
  if (!b.auto || !b.dir || b.busy) return false
  const due =
    force ||
    !b.lastAt ||
    Date.now() - new Date(b.lastAt).getTime() >= b.everyDays * 24 * 3_600_000 - 3_600_000
  if (!due) return false
  setApp((s) => ({ backup: { ...s.backup, busy: true } }))
  try {
    const tz = rt?.owner.tz ?? 'America/Sao_Paulo'
    const file = await join(b.dir, backupFileName(new Date(), tz))
    await writeBackupTo(file)
    const names = (await readDir(b.dir))
      .filter((e) => e.isFile && BACKUP_FILE_PATTERN.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
    for (const old of names.slice(BACKUP_KEEP)) await removeFile(await join(b.dir, old))
    await setSetting('backup_last_at', new Date().toISOString())
    await setSetting('backup_last_error', '')
    return true
  } catch (e) {
    log.warn('backup automático falhou', { error: String(e) })
    await setSetting('backup_last_error', 'Não consegui gravar na pasta escolhida.')
    if (!force) showToast('O backup automático falhou. Veja em Ajustes.', 'warn')
    return false
  } finally {
    setApp((s) => ({ backup: { ...s.backup, busy: false } }))
    await loadBackupState()
  }
}

async function startBackupScheduler() {
  await loadBackupState()
  clearInterval(backupTimer)
  setTimeout(() => void runBackupIfDue(), 8_000)
  backupTimer = setInterval(() => void runBackupIfDue(), 3_600_000)
}

/**
 * Apaga tudo do dono neste aparelho e reinicia o app no cadastro.
 * Backups que a pessoa salvou em pastas dela NÃO são tocados (o aviso fica na tela).
 * A nuvem entra aqui na Fase 6.
 */
export async function eraseEverything(opts: { removeKey: boolean }): Promise<void> {
  clearInterval(housekeeping)
  clearInterval(backupTimer)
  await rt?.orchestrator.stop()
  await eraseAllData(db)
  // Gravações do histórico do chat que ainda estavam a caminho.
  await new Promise((r) => setTimeout(r, 300))
  await db.delete(schema.chatLog)
  if (opts.removeKey) await secrets.delete('openrouter_api_key')
  location.reload()
}

// --------------------------------------------------------------------- ajustes

export async function saveKey(key: string) {
  const clean = key.trim()
  if (!clean) return
  await secrets.set('openrouter_api_key', clean)
  setApp({ hasKey: true })
  showToast('Chave salva no cofre do sistema.')
}

export async function removeKey() {
  await secrets.delete('openrouter_api_key')
  setApp({ hasKey: false })
  showToast('Chave removida.', 'warn')
}

export interface KeyInfo {
  ok: boolean
  limit: number | null
  remaining: number | null
  usage: number
  message?: string
}

/** Consulta o saldo da chave no OpenRouter. Nunca exibe nem registra a chave. */
export async function testKey(candidate?: string): Promise<KeyInfo> {
  const key = candidate?.trim() || (await secrets.get('openrouter_api_key'))
  if (!key) return { ok: false, limit: null, remaining: null, usage: 0, message: 'Nenhuma chave.' }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const json = (await res.json()) as {
      data?: { limit: number | null; limit_remaining: number | null; usage: number }
      error?: { message?: string }
    }
    if (!res.ok || !json.data) {
      return {
        ok: false,
        limit: null,
        remaining: null,
        usage: 0,
        message: json.error?.message ?? `HTTP ${res.status}`,
      }
    }
    return {
      ok: true,
      limit: json.data.limit,
      remaining: json.data.limit_remaining,
      usage: json.data.usage,
    }
  } catch {
    return {
      ok: false,
      limit: null,
      remaining: null,
      usage: 0,
      message: 'Sem conexão com o OpenRouter.',
    }
  }
}

export async function readCaps(): Promise<{ daily: number; monthly: number }> {
  const cfg = loadModelsConfig().limits
  const d = Number(await getSetting('cap_daily_usd'))
  const m = Number(await getSetting('cap_monthly_usd'))
  return {
    daily:
      Number.isFinite(d) && (await getSetting('cap_daily_usd')) !== undefined ? d : cfg.dailyUsd,
    monthly:
      Number.isFinite(m) && (await getSetting('cap_monthly_usd')) !== undefined
        ? m
        : cfg.monthlyUsd,
  }
}

export async function saveCaps(daily: number, monthly: number) {
  await setSetting('cap_daily_usd', String(Math.max(0, daily)))
  await setSetting('cap_monthly_usd', String(Math.max(0, monthly)))
  showToast('Tetos de gasto atualizados.')
}

/** Apaga conversa, itens e mensagens de teste. Mantém dono, ajustes e histórico de gastos. */
export async function resetTestData() {
  await db.delete(schema.assignments)
  await db.delete(schema.reminders)
  await db.delete(schema.items)
  await db.delete(schema.messages)
  await db.delete(schema.conversationState)
  await db.delete(schema.chatLog)
  setApp({ entries: [], statuses: {}, agenda: [] })
  await greet()
  await refreshAll()
  showToast('Dados de teste apagados.', 'warn')
}

// ------------------------------------------------------------- desenvolvimento

export async function advanceClock(ms: number) {
  if (!rt) return
  rt.offsetMs = ms === 0 ? 0 : rt.offsetMs + ms
  setApp({ clockOffsetMs: rt.offsetMs })
  const expired = await rt.orchestrator.expireStale()
  if (expired > 0) showToast(`${expired} proposta(s) expiraram.`, 'warn')
  await rt.orchestrator.tickReminders()
  await refreshAll()
}

/** Painel de dev: dispara agora os lembretes que já venceram no relógio virtual. */
export async function tickRemindersNow(): Promise<number> {
  if (!rt) return 0
  const n = await rt.orchestrator.tickReminders()
  await refreshAll()
  return n
}

export const virtualNow = now
export function ownerTz(): string {
  return rt?.owner.tz ?? 'America/Sao_Paulo'
}
