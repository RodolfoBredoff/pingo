import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { spring } from '../lib/motion'

const VERBS = [
  'Lendo a mensagem…',
  'Separando datas, tarefas e responsáveis…',
  'Conferindo horários…',
  'Montando o cartão…',
]

/** "Digitando…" com três bolinhas em onda e um texto que troca a cada 1,6 s. */
export function TypingIndicator() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, VERBS.length - 1)), 1600)
    return () => clearInterval(t)
  }, [])

  return (
    <motion.div
      role="status"
      aria-label="O Pingo está organizando"
      initial={{ opacity: 0, y: 12, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
      transition={spring}
      style={{ originX: 0 }}
      className="flex w-fit max-w-[88%] items-center gap-3 rounded-[22px] rounded-bl-md border border-line bg-surface px-4 py-3 shadow-card"
    >
      <span className="flex items-end gap-1">
        {[0, 1, 2].map((d) => (
          <motion.span
            key={d}
            className="size-2 rounded-full bg-primary"
            animate={{ y: [0, -6, 0], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.14, ease: 'easeInOut' }}
          />
        ))}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="font-serif text-[14px] italic text-ink/70"
        >
          {VERBS[i]}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  )
}
