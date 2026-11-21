import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { dropFx, useApp, type FxEvent } from '../app/store'
import { AGENDA_BUMP_EVENT } from './TabBar'

const COLORS = ['var(--sun)', 'var(--mint)', 'var(--primary)', 'var(--sky)', 'var(--berry)']
const SHAPES = ['50%', '3px', '50% 50% 50% 0'] // círculo, quadradinho, gota

/** Camada de efeitos por cima de tudo: confete geométrico e o "voo" até a Agenda. */
export function FxLayer() {
  const fx = useApp((s) => s.fx)
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {fx.map((e) =>
        e.kind === 'confetti' ? <Confetti key={e.id} e={e} /> : <Fly key={e.id} e={e} />,
      )}
    </div>
  )
}

function makePieces() {
  return Array.from({ length: 18 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.5
    const dist = 50 + Math.random() * 70
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 20,
      rot: (Math.random() - 0.5) * 540,
      size: 6 + Math.random() * 6,
      color: COLORS[i % COLORS.length]!,
      radius: SHAPES[i % SHAPES.length]!,
      delay: Math.random() * 0.06,
    }
  })
}

function Confetti({ e }: { e: FxEvent }) {
  const reduce = useReducedMotion()
  const [pieces] = useState(makePieces)
  useEffect(() => {
    const t = setTimeout(() => dropFx(e.id), reduce ? 0 : 1500)
    return () => clearTimeout(t)
  }, [e.id, reduce])
  if (reduce) return null

  return (
    <>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{
            left: e.x,
            top: e.y,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.radius,
          }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{
            x: p.dx,
            y: [0, p.dy, p.dy + 90],
            opacity: [1, 1, 0],
            scale: 1,
            rotate: p.rot,
          }}
          transition={{ duration: 1.1, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </>
  )
}

function Fly({ e }: { e: FxEvent }) {
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!reduce) return
    window.dispatchEvent(new Event(AGENDA_BUMP_EVENT))
    dropFx(e.id)
  }, [e.id, reduce])
  if (reduce) return null

  const toX = e.toX ?? e.x
  const toY = e.toY ?? e.y
  return (
    <motion.span
      className="absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-white shadow-pop"
      style={{ left: 0, top: 0, background: e.color ?? 'var(--mint)' }}
      initial={{ x: e.x, y: e.y, scale: 0.6, opacity: 1 }}
      animate={{
        x: [e.x, (e.x + toX) / 2 + 30, toX],
        y: [e.y, Math.min(e.y, toY) - 90, toY],
        scale: [0.6, 1.25, 0.45],
        opacity: [1, 1, 0.3],
      }}
      transition={{ duration: 0.85, ease: [0.3, 0.7, 0.3, 1] }}
      onAnimationComplete={() => {
        window.dispatchEvent(new Event(AGENDA_BUMP_EVENT))
        dropFx(e.id)
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </motion.span>
  )
}
