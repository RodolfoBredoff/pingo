import { motion } from 'motion/react'
import type { ReplyButton } from '@pingo/shared'
import { haptic, springBouncy } from '../lib/motion'

interface Props {
  buttons: ReplyButton[]
  pressed?: string
  onPress: (b: ReplyButton) => void
}

/** Botões de resposta rápida. Ao escolher um, os outros esmaecem e o escolhido ganha cor. */
export function QuickReplies({ buttons, pressed, onPress }: Props) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {buttons.map((b, i) => {
        const chosen = pressed === b.id
        const locked = !!pressed
        return (
          <motion.button
            key={b.id}
            disabled={locked}
            onClick={() => {
              haptic()
              onPress(b)
            }}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: locked && !chosen ? 0.35 : 1, y: 0, scale: chosen ? 1.04 : 1 }}
            transition={{ ...springBouncy, delay: i * 0.05 }}
            whileHover={locked ? undefined : { rotate: i % 2 ? 1 : -1, y: -2 }}
            whileTap={locked ? undefined : { scale: 0.94 }}
            className={
              chosen
                ? 'rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg'
                : 'rounded-full border border-ink/15 bg-surface px-4 py-2 text-sm font-semibold hover:border-primary/60'
            }
          >
            {b.title}
          </motion.button>
        )
      })}
    </div>
  )
}
