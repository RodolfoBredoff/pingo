import { CheckCircle, WarningCircle, XCircle } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '../app/store'
import { springBouncy } from '../lib/motion'

const TONE = {
  ok: { Icon: CheckCircle, color: 'text-mint' },
  warn: { Icon: WarningCircle, color: 'text-sun' },
  error: { Icon: XCircle, color: 'text-primary' },
} as const

export function ToastHost() {
  const toast = useApp((s) => s.toast)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-40 flex justify-center px-6">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95, transition: { duration: 0.15 } }}
            transition={springBouncy}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-bg shadow-pop"
          >
            {(() => {
              const { Icon, color } = TONE[toast.tone]
              return <Icon weight="fill" className={`size-5 ${color}`} />
            })()}
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
