import { Clock, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { localDate, localTime } from '@pingo/core'
import { advanceClock, ownerTz, tickRemindersNow, virtualNow } from '../app/controller'
import { setApp, useApp } from '../app/store'
import { spring } from '../lib/motion'

const H = 3_600_000
const STEPS: [string, number][] = [
  ['+1 h', H],
  ['+1 dia', 24 * H],
  ['+49 h', 49 * H],
  ['+1 semana', 7 * 24 * H],
]

/** Painel de desenvolvedor (só em `tauri dev`): relógio virtual, última extração, gasto. */
export function DevPanel() {
  const open = useApp((s) => s.devOpen)
  const offset = useApp((s) => s.clockOffsetMs)
  const lastRun = useApp((s) => s.lastRun)
  const spend = useApp((s) => s.spend)
  const tz = ownerTz()
  const now = virtualNow()

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%', transition: { duration: 0.18 } }}
          transition={spring}
          aria-label="Painel de desenvolvedor"
          className="fixed inset-y-0 right-0 z-40 flex w-[min(380px,100%)] flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4 shadow-pop"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Desenvolvedor</h2>
            <button
              aria-label="Fechar"
              onClick={() => setApp({ devOpen: false })}
              className="grid size-9 place-items-center rounded-full hover:bg-ink/10"
            >
              <X weight="bold" className="size-5" />
            </button>
          </div>

          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/55">
              <Clock weight="duotone" className="size-4" /> Relógio virtual
            </h3>
            <p className="font-mono text-sm tabular-nums">
              {localDate(now, tz)} {localTime(now, tz)}
              <span className="text-ink/50">
                {' '}
                ({offset >= 0 ? '+' : ''}
                {Math.round(offset / H)} h)
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {STEPS.map(([label, ms]) => (
                <button
                  key={label}
                  onClick={() => void advanceClock(ms)}
                  className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold"
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => void tickRemindersNow()}
                className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold"
              >
                Disparar lembretes
              </button>
              <button
                onClick={() => void advanceClock(0)}
                className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-bg"
              >
                Zerar
              </button>
            </div>
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink/55">
              Gasto de IA
            </h3>
            <p className="font-mono text-sm">
              hoje US${spend.today.toFixed(5)} · mês US${spend.month.toFixed(5)}
            </p>
          </section>

          <section className="min-h-0 flex-1">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink/55">
              Última chamada de IA
            </h3>
            {lastRun ? (
              <>
                <p className="mb-2 font-mono text-xs">
                  {lastRun.role} · {lastRun.model}
                </p>
                <pre className="scroll-soft max-h-[46vh] overflow-auto rounded-2xl bg-ink/6 p-3 font-mono text-[11px] leading-snug">
                  {lastRun.json}
                </pre>
              </>
            ) : (
              <p className="text-sm text-ink/55">Nenhuma ainda. Mande uma mensagem.</p>
            )}
          </section>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
