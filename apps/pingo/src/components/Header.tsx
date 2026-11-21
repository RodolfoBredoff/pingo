import { Bug, Warning } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { goTab, setApp, useApp } from '../app/store'
import { spring } from '../lib/motion'
import { PingoMark } from './PingoMark'

export function Header() {
  const hasKey = useApp((s) => s.hasKey)
  const typing = useApp((s) => s.typing)
  const devOpen = useApp((s) => s.devOpen)

  return (
    <header className="flex items-center gap-3 px-5 pt-5 pb-3">
      <motion.div
        animate={typing ? { rotate: [0, -8, 8, -6, 0], y: [0, -3, 0] } : { rotate: 0, y: 0 }}
        transition={typing ? { duration: 0.9, repeat: Infinity } : spring}
      >
        <PingoMark size={40} />
      </motion.div>

      <div className="min-w-0 flex-1 leading-none">
        <h1 className="stretch-title text-[28px]">pingo</h1>
        <p className="mt-1 truncate font-serif text-[13px] italic text-ink/60">
          recado vira compromisso
        </p>
      </div>

      {hasKey === false && (
        <button
          onClick={() => goTab('settings')}
          className="flex items-center gap-1.5 rounded-full bg-sun/35 px-3 py-1.5 text-xs font-semibold"
        >
          <Warning weight="fill" className="size-4 text-primary" />
          falta a chave
        </button>
      )}
      {hasKey && (
        <span className="flex items-center gap-1.5 rounded-full bg-mint/20 px-3 py-1.5 text-xs font-semibold">
          <span className="size-2 rounded-full bg-mint" />
          pronto
        </span>
      )}

      {import.meta.env.DEV && (
        <button
          aria-label="Painel de desenvolvedor"
          aria-pressed={devOpen}
          onClick={() => setApp((s) => ({ devOpen: !s.devOpen }))}
          className="grid size-9 place-items-center rounded-full border border-line bg-surface/70"
        >
          <Bug weight={devOpen ? 'fill' : 'duotone'} className="size-5" />
        </button>
      )}
    </header>
  )
}
