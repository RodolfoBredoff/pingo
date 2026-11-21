import {
  CheckCircle,
  DownloadSimple,
  Eye,
  EyeSlash,
  Moon,
  FolderOpen,
  Plus,
  Sun,
  SunHorizon,
  Trash,
  UploadSimple,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { loadModelsConfig } from '@pingo/core'
import {
  addContactUi,
  applyImport,
  chooseBackupDir,
  discardPendingImport,
  eraseEverything,
  exportBackupFile,
  pickBackupToImport,
  readCaps,
  runBackupIfDue,
  setBackupAuto,
  setBackupEvery,
  type ImportPreview,
  removeContactUi,
  refreshSpend,
  removeKey,
  resetTestData,
  saveCaps,
  saveKey,
  setAutostart,
  setReduceMotion,
  setThemeMode,
  testKey,
  type KeyInfo,
} from '../app/controller'
import { useApp, type ThemeMode } from '../app/store'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { spring, springBouncy } from '../lib/motion'

const usd = (n: number) => `US$ ${n.toFixed(n < 0.1 ? 4 : 2)}`

export function SettingsView() {
  const hasKey = useApp((s) => s.hasKey)
  const spend = useApp((s) => s.spend)
  const theme = useApp((s) => s.theme)
  const reduce = useApp((s) => s.reduceMotion)
  const autostart = useApp((s) => s.autostart)

  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [info, setInfo] = useState<KeyInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [caps, setCaps] = useState({ daily: 0.25, monthly: 4 })
  const [armed, setArmed] = useState(false)
  const config = loadModelsConfig()

  useEffect(() => {
    void readCaps().then(setCaps)
    void refreshSpend()
  }, [])

  async function check(candidate?: string) {
    setBusy(true)
    setInfo(await testKey(candidate))
    setBusy(false)
  }

  return (
    <div className="scroll-soft h-full overflow-y-auto px-4 pb-6">
      <div className="px-1 pt-2 pb-4">
        <h2 className="stretch-title text-[34px] leading-none">ajustes</h2>
        <p className="mt-1 font-serif text-[14px] italic text-ink/60">tudo fica neste aparelho</p>
      </div>

      <Section title="Chave do OpenRouter" hint="Guardada no cofre do sistema, nunca em arquivo.">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2/60 px-3">
          <input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? '•••••••• (já salva)' : 'sk-or-v1-…'}
            aria-label="Chave do OpenRouter"
            autoComplete="off"
            spellCheck={false}
            className="h-11 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-ink/35"
          />
          <button
            aria-label={show ? 'Esconder' : 'Mostrar'}
            onClick={() => setShow((v) => !v)}
            className="p-1.5 text-ink/60"
          >
            {show ? <EyeSlash className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn
            primary
            disabled={!key.trim() || busy}
            onClick={async () => {
              const k = key
              await saveKey(k)
              setKey('')
              await check(k)
            }}
          >
            Salvar
          </Btn>
          <Btn
            disabled={busy || (!hasKey && !key.trim())}
            onClick={() => void check(key || undefined)}
          >
            {busy ? 'Testando…' : 'Testar chave'}
          </Btn>
          {hasKey && (
            <Btn
              danger
              onClick={async () => {
                await removeKey()
                setInfo(null)
              }}
            >
              Remover
            </Btn>
          )}
        </div>
        {info && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="mt-3 flex items-start gap-2 rounded-2xl bg-ink/6 px-3 py-2.5 text-[13px]"
          >
            {info.ok ? (
              <CheckCircle weight="fill" className="mt-0.5 size-5 shrink-0 text-mint" />
            ) : (
              <XCircle weight="fill" className="mt-0.5 size-5 shrink-0 text-primary" />
            )}
            <span>
              {info.ok
                ? `Chave válida. Usado: ${usd(info.usage)}${info.limit != null ? ` de ${usd(info.limit)}` : ''}${info.remaining != null ? ` (restam ${usd(info.remaining)})` : ''}.`
                : (info.message ?? 'Chave inválida.')}
            </span>
          </motion.p>
        )}
      </Section>

      <Section title="Gastos com IA" hint="Quando o teto é atingido, o Pingo para de chamar a IA.">
        <Meter label="Hoje" value={spend.today} cap={caps.daily} />
        <Meter label="Este mês" value={spend.month} cap={caps.monthly} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Num
            label="Teto diário (US$)"
            value={caps.daily}
            onChange={(v) => setCaps((c) => ({ ...c, daily: v }))}
          />
          <Num
            label="Teto mensal (US$)"
            value={caps.monthly}
            onChange={(v) => setCaps((c) => ({ ...c, monthly: v }))}
          />
        </div>
        <div className="mt-3">
          <Btn onClick={() => void saveCaps(caps.daily, caps.monthly)}>Salvar tetos</Btn>
        </div>
      </Section>

      <Section
        title="Contatos"
        hint="Pessoas para quem você pode passar itens. Antes de mandar qualquer coisa, o Pingo pede permissão a elas."
      >
        <Contacts />
      </Section>

      {autostart !== null && (
        <Section title="No computador">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">Abrir com o computador</span>
              <span className="block text-xs text-ink/55">
                Fica na bandeja, só para os lembretes chegarem na hora. Fechar a janela não encerra
                o Pingo.
              </span>
            </span>
            <Toggle on={autostart} onChange={(v) => void setAutostart(v)} />
          </label>
        </Section>
      )}

      <Section title="Aparência">
        <Segmented<ThemeMode>
          value={theme}
          onChange={(v) => void setThemeMode(v)}
          options={[
            { id: 'auto', label: 'Auto', Icon: SunHorizon },
            { id: 'light', label: 'Claro', Icon: Sun },
            { id: 'dark', label: 'Escuro', Icon: Moon },
          ]}
        />
        <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">Reduzir movimento</span>
            <span className="block text-xs text-ink/55">
              Menos animação e sem confete. Já segue o sistema por padrão.
            </span>
          </span>
          <Toggle on={reduce} onChange={(v) => void setReduceMotion(v)} />
        </label>
      </Section>

      <Section
        title="Modelos de IA"
        hint="Definidos em models.json. O primeiro de cada lista é o preferido."
      >
        <ul className="grid gap-1.5">
          {(Object.entries(config.roles) as [string, { id: string }[]][]).map(([role, list]) => (
            <li key={role} className="flex items-center gap-3 rounded-xl bg-surface-2/60 px-3 py-2">
              <span className="w-14 font-mono text-[11px] uppercase text-ink/55">{role}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{list[0]?.id}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink/55">
          Privacidade: só provedores que não guardam nem treinam com seus dados (data_collection:
          deny).
        </p>
      </Section>

      <Section
        title="Privacidade e dados"
        hint="Tudo fica neste aparelho. O backup é um arquivo seu: guarde-o em lugar seguro."
      >
        <Privacy />
      </Section>

      {import.meta.env.DEV && (
        <Section
          title="Dados de teste"
          hint="Apaga conversa, itens e mensagens. Mantém chave, ajustes e histórico de gastos."
        >
          <Btn
            danger
            onClick={async () => {
              if (!armed) {
                setArmed(true)
                setTimeout(() => setArmed(false), 3500)
                return
              }
              setArmed(false)
              await resetTestData()
            }}
          >
            <Trash weight="duotone" className="size-4" />
            {armed ? 'Tem certeza? Toque de novo' : 'Apagar dados de teste'}
          </Btn>
        </Section>
      )}
    </div>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'ainda não'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

function Privacy() {
  const consentAt = useApp((s) => s.consentAt)
  const backup = useApp((s) => s.backup)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [eraseOpen, setEraseOpen] = useState(false)
  const [alsoKey, setAlsoKey] = useState(false)
  const [erasing, setErasing] = useState(false)

  async function pick() {
    setImportError(null)
    const r = await pickBackupToImport()
    if (!r) return
    if ('error' in r) setImportError(r.error)
    else setPreview(r)
  }

  return (
    <div className="grid gap-4">
      <p className="text-[12.5px] text-ink/55">
        Você aceitou o aviso de privacidade em {fmtDate(consentAt)}.
      </p>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Backup</h4>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => void exportBackupFile()}>
            <DownloadSimple weight="bold" className="size-4" /> Exportar
          </Btn>
          <Btn onClick={() => void pick()}>
            <UploadSimple weight="bold" className="size-4" /> Importar
          </Btn>
        </div>
        {importError && <p className="mt-2 text-[12.5px] text-primary">{importError}</p>}
        <p className="mt-2 text-[12px] text-ink/55">
          O arquivo tem sua agenda, contatos e conversa, sem criptografia e sem a chave do
          OpenRouter.
        </p>
      </div>

      <div>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">Backup automático</span>
            <span className="block text-xs text-ink/55">
              Grava numa pasta sua e mantém os 7 mais recentes.
            </span>
          </span>
          <Toggle on={backup.auto} onChange={(v) => void setBackupAuto(v)} />
        </label>
        {backup.auto && (
          <div className="mt-3 grid gap-2">
            <div className="flex items-center gap-2 rounded-2xl bg-surface-2/60 px-3 py-2">
              <FolderOpen weight="duotone" className="size-5 shrink-0 text-ink/60" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {backup.dir ?? 'Nenhuma pasta escolhida'}
              </span>
              <button
                onClick={() => void chooseBackupDir()}
                className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold"
              >
                {backup.dir ? 'Trocar' : 'Escolher'}
              </button>
            </div>
            <div
              role="radiogroup"
              aria-label="Frequência"
              className="flex rounded-full bg-ink/8 p-1"
            >
              {(
                [
                  [1, 'Todo dia'],
                  [7, 'Toda semana'],
                ] as const
              ).map(([d, label]) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={backup.everyDays === d}
                  onClick={() => void setBackupEvery(d)}
                  className="relative flex-1 rounded-full py-1.5 text-[13px] font-semibold"
                >
                  {backup.everyDays === d && (
                    <motion.span
                      layoutId="backup-every"
                      transition={springBouncy}
                      className="absolute inset-0 rounded-full bg-surface shadow-card"
                    />
                  )}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className={backup.lastError ? 'text-primary' : 'text-ink/60'}>
                {backup.lastError ?? `Último: ${fmtDate(backup.lastAt)}`}
              </span>
              <button
                disabled={!backup.dir || backup.busy}
                onClick={() => void runBackupIfDue(true)}
                className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold disabled:opacity-40"
              >
                {backup.busy ? 'Salvando…' : 'Fazer agora'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Warning weight="fill" className="size-4 text-primary" /> Apagar tudo
        </h4>
        <p className="mt-1 text-[12.5px] text-ink/65">
          Remove agenda, contatos, conversa e histórico deste aparelho. Backups que você salvou em
          pastas suas continuam lá.
        </p>
        <div className="mt-2">
          <Btn danger onClick={() => setEraseOpen(true)}>
            <Trash weight="duotone" className="size-4" /> Apagar meus dados
          </Btn>
        </div>
      </div>

      <ConfirmDialog
        open={!!preview}
        title="Trocar seus dados por este backup?"
        confirmLabel="Importar"
        busy={importing}
        danger
        onCancel={() => {
          discardPendingImport()
          setPreview(null)
        }}
        onConfirm={async () => {
          setImporting(true)
          const r = await applyImport()
          if (!r.ok) {
            setImportError(r.message)
            setImporting(false)
            setPreview(null)
          }
        }}
      >
        {preview && (
          <>
            <p>
              Backup de {fmtDate(preview.exportedAt)}: {preview.items} itens, {preview.contacts}{' '}
              contatos e {preview.messages} mensagens.
            </p>
            <p>
              Tudo o que está no Pingo agora será <strong>substituído</strong>. Se algo der errado
              no meio, seus dados atuais voltam sozinhos.
            </p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={eraseOpen}
        title="Apagar todos os seus dados?"
        confirmLabel="Apagar tudo"
        typeToConfirm="APAGAR"
        danger
        busy={erasing}
        onCancel={() => setEraseOpen(false)}
        onConfirm={async () => {
          setErasing(true)
          await eraseEverything({ removeKey: alsoKey })
        }}
      >
        <p>
          Isso apaga agenda, contatos, conversa e histórico deste aparelho e volta o Pingo ao
          começo. <strong>Não dá para desfazer.</strong>
        </p>
        <label className="flex cursor-pointer items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={alsoKey}
            onChange={(e) => setAlsoKey(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
          />
          Remover também a chave do OpenRouter guardada no cofre do sistema.
        </label>
      </ConfirmDialog>
    </div>
  )
}

function Contacts() {
  const contacts = useApp((s) => s.contacts)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add() {
    const r = await addContactUi(name, phone)
    if (r.ok) {
      setName('')
      setPhone('')
      setError(null)
    } else {
      setError(r.message)
    }
  }

  return (
    <div>
      {contacts.length === 0 ? (
        <p className="mb-3 text-[13px] text-ink/55">Nenhum contato ainda.</p>
      ) : (
        <ul className="mb-3 grid gap-1.5">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-2xl bg-surface-2/60 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.name}</span>
                <span className="block font-mono text-[11.5px] text-ink/55">{c.phone}</span>
              </span>
              <span
                className={
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold ' +
                  (c.status === 'active' ? 'bg-mint/30' : 'bg-sun/30')
                }
              >
                {c.status === 'active' ? 'aceitou' : 'aguardando aceite'}
              </span>
              <button
                aria-label={`Remover ${c.name}`}
                onClick={() => void removeContactUi(c.id)}
                className="grid size-8 place-items-center rounded-full text-ink/50 hover:bg-ink/10"
              >
                <Trash className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome"
          aria-label="Nome do contato"
          className="h-11 min-w-0 rounded-2xl border border-line bg-surface-2/60 px-3 text-sm outline-none placeholder:text-ink/35"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="11 98888-7777"
          inputMode="tel"
          aria-label="Telefone do contato"
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          className="h-11 min-w-0 rounded-2xl border border-line bg-surface-2/60 px-3 font-mono text-sm outline-none placeholder:text-ink/35"
        />
        <motion.button
          aria-label="Adicionar contato"
          disabled={!name.trim() || !phone.trim()}
          onClick={() => void add()}
          whileTap={{ scale: 0.9 }}
          transition={springBouncy}
          className="grid size-11 place-items-center rounded-full bg-ink text-bg disabled:opacity-40"
        >
          <Plus weight="bold" className="size-5" />
        </motion.button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-primary">{error}</p>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="mb-3 rounded-[26px] border border-line bg-surface p-4 shadow-card"
    >
      <h3 className="font-display text-[18px] font-bold leading-tight">{title}</h3>
      {hint && <p className="mt-0.5 mb-3 text-[12.5px] text-ink/55">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </motion.section>
  )
}

function Btn({
  children,
  onClick,
  primary,
  danger,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <motion.button
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      whileHover={{ y: -2 }}
      transition={springBouncy}
      className={
        'flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ' +
        (primary
          ? 'bg-ink text-bg'
          : danger
            ? 'border border-primary/40 text-primary'
            : 'border border-ink/15')
      }
    >
      {children}
    </motion.button>
  )
}

function Meter({ label, value, cap }: { label: string; value: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (value / cap) * 100) : 100
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="font-mono tabular-nums text-ink/65">
          {usd(value)} / {usd(cap)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-ink/10">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={springBouncy}
          className={
            'h-full rounded-full ' + (pct > 85 ? 'bg-primary' : pct > 60 ? 'bg-sun' : 'bg-mint')
          }
        />
      </div>
    </div>
  )
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-[12px] font-semibold text-ink/65">
      {label}
      <input
        type="number"
        min={0}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-11 w-full rounded-2xl border border-line bg-surface-2/60 px-3 font-mono text-sm text-ink outline-none"
      />
    </label>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={
        'relative h-8 w-14 shrink-0 rounded-full transition-colors ' +
        (on ? 'bg-mint' : 'bg-ink/20')
      }
    >
      <motion.span
        layout
        transition={springBouncy}
        className="absolute top-1 size-6 rounded-full bg-white shadow"
        style={{ left: on ? 28 : 4 }}
      />
    </button>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string; Icon: typeof Sun }[]
}) {
  return (
    <div role="radiogroup" className="flex rounded-full bg-ink/8 p-1">
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className="relative flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold"
        >
          {value === id && (
            <motion.span
              layoutId="theme-pill"
              transition={springBouncy}
              className="absolute inset-0 rounded-full bg-surface shadow-card"
            />
          )}
          <Icon weight={value === id ? 'fill' : 'duotone'} className="relative size-[18px]" />
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  )
}
