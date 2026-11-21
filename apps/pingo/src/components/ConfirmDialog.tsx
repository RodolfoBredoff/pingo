import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { spring, springBouncy } from '../lib/motion'

interface Props {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Botão de confirmação em vermelho. */
  danger?: boolean
  /** Se informado, a pessoa precisa digitar esta palavra para liberar o botão. */
  typeToConfirm?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Janela de confirmação para ações sem volta. Fecha com Esc ou tocando fora. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancelar',
  danger,
  typeToConfirm,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState('')
  const titleId = useId()
  const ready = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  return createPortal(
    <AnimatePresence onExitComplete={() => setTyped('')}>
      {open && (
        <Overlay onClick={() => !busy && onCancel()}>
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ y: 30, scale: 0.92, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 20, scale: 0.96, opacity: 0, transition: { duration: 0.14 } }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] rounded-[28px] border border-line bg-surface p-5 shadow-pop"
          >
            <h3 id={titleId} className="font-display text-[22px] font-bold leading-tight">
              {title}
            </h3>
            <div className="mt-2 grid gap-3 text-[14px] leading-snug text-ink/75">{children}</div>
            {typeToConfirm && (
              <label className="mt-3 block text-[12.5px] font-semibold text-ink/65">
                Para confirmar, digite <span className="font-mono">{typeToConfirm}</span>
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 h-11 w-full rounded-2xl border border-line bg-surface-2/60 px-3 font-mono text-sm text-ink outline-none focus:border-primary"
                />
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                disabled={busy}
                onClick={onCancel}
                className="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold disabled:opacity-40"
              >
                {cancelLabel}
              </button>
              <motion.button
                disabled={!ready || busy}
                onClick={onConfirm}
                whileTap={{ scale: 0.95 }}
                transition={springBouncy}
                className={
                  'rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ' +
                  (danger ? 'bg-primary' : 'bg-ink')
                }
              >
                {busy ? 'Aguarde…' : confirmLabel}
              </motion.button>
            </div>
          </motion.div>
        </Overlay>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Fundo da janela. Enquanto anima a saída, fica inerte e marcado como "fechando". */
function Overlay({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClick}
      data-closing={!present}
      style={{ pointerEvents: present ? 'auto' : 'none' }}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-5 backdrop-blur-[2px]"
    >
      {children}
    </motion.div>
  )
}
