import {
  ArrowBendUpLeft,
  BellRinging,
  CalendarBlank,
  Check,
  MapPin,
  PencilSimple,
  Trash,
  UserCircle,
  X,
  type Icon,
} from '@phosphor-icons/react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useRef, useState } from 'react'
import type { CardFieldKey, ItemCard } from '@pingo/shared'
import type { ItemStatus } from '@pingo/core'
import { goTab, pushFx } from '../app/store'
import { pressCard } from '../app/controller'
import { KIND_META } from '../lib/kinds'
import { haptic, spring, springBouncy } from '../lib/motion'

const FIELD_ICON: Record<CardFieldKey, Icon> = {
  when: CalendarBlank,
  where: MapPin,
  who: UserCircle,
  reminder: BellRinging,
}

interface Props {
  card: ItemCard
  status: ItemStatus | undefined
  /** Existe um cartão mais novo do mesmo item (depois de uma edição). */
  superseded: boolean
}

const rectCenter = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function ItemCardView({ card, status, superseded }: Props) {
  const meta = KIND_META[card.kind]
  const proposed = !status || status === 'proposed'
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState(false)

  const x = useMotionValue(0)
  const okOpacity = useTransform(x, [20, 110], [0, 1])
  const noOpacity = useTransform(x, [-110, -20], [1, 0])
  const rotate = useTransform(x, [-160, 160], [-4, 4])

  const when = card.fields.find((f) => f.key === 'when')?.value

  async function confirm(from?: Element | null) {
    if (confirming) return
    setConfirming(true)
    haptic(18)
    const origin = from ? rectCenter(from) : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const target = document.getElementById('tab-agenda-icon')
    pushFx({ kind: 'confetti', x: origin.x, y: origin.y })
    if (target) {
      const t = rectCenter(target)
      pushFx({ kind: 'fly', x: origin.x, y: origin.y, toX: t.x, toY: t.y, color: 'var(--mint)' })
    }
    // Deixa o botão "preencher" antes do cartão encolher.
    await new Promise((r) => setTimeout(r, 260))
    await pressCard(`confirm:${card.itemId}`)
  }

  async function discard() {
    haptic(8)
    await pressCard(`discard:${card.itemId}`)
  }

  // ---------------------------------------------------------------- compactos
  if (superseded && proposed) {
    return (
      <motion.div
        layout
        transition={spring}
        className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-3 py-2 text-[13px] text-ink/50"
      >
        <ArrowBendUpLeft className="size-4" />
        <span className="truncate">Versão anterior de “{card.title}”</span>
      </motion.div>
    )
  }

  if (status === 'confirmed' || status === 'done') {
    return (
      <motion.button
        layout
        transition={spring}
        onClick={() => goTab('agenda')}
        className="flex w-full items-center gap-3 rounded-[22px] border border-mint/40 bg-mint/15 px-4 py-3 text-left"
        aria-label={`${card.title} está na agenda. Abrir agenda.`}
      >
        <motion.span
          initial={{ scale: 0, rotate: -40 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={springBouncy}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-mint text-white"
        >
          <Check weight="bold" className="size-4" />
        </motion.span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[16px] font-bold leading-tight">
            {card.title}
          </span>
          <span className="block truncate font-mono text-[12px] text-ink/60">
            Na agenda{when ? ` · ${when}` : ''}
          </span>
        </span>
      </motion.button>
    )
  }

  if (status === 'discarded' || status === 'expired' || status === 'cancelled') {
    return (
      <motion.div
        layout
        transition={spring}
        className="flex items-center gap-3 rounded-[22px] border border-line bg-surface/60 px-4 py-3 opacity-70"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink/10">
          <X weight="bold" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[16px] font-bold leading-tight line-through decoration-ink/40">
            {card.title}
          </span>
          <span className="block font-mono text-[12px] text-ink/60">
            {status === 'expired' ? 'Expirou sem resposta' : 'Descartado'}
          </span>
        </span>
      </motion.div>
    )
  }

  // ------------------------------------------------------------------ completo
  return (
    <motion.article
      layout
      transition={spring}
      aria-label={`Proposta: ${card.title}`}
      className="relative w-full select-none"
    >
      {/* fundos revelados pelo gesto de deslizar */}
      <motion.div
        style={{ opacity: okOpacity }}
        className="absolute inset-0 flex items-center justify-start rounded-[26px] bg-mint pl-6"
      >
        <Check weight="bold" className="size-7 text-white" />
      </motion.div>
      <motion.div
        style={{ opacity: noOpacity }}
        className="absolute inset-0 flex items-center justify-end rounded-[26px] bg-primary pr-6"
      >
        <X weight="bold" className="size-7 text-white" />
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.35}
        style={{ x, rotate }}
        onDragEnd={(_, info) => {
          if (info.offset.x > 110) void confirm(confirmBtn.current)
          else if (info.offset.x < -110) void discard()
          else animate(x, 0, spring)
        }}
        className="relative overflow-hidden rounded-[26px] border border-line bg-surface shadow-card"
      >
        {/* faixa do tipo */}
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ background: `color-mix(in srgb, ${meta.color} 20%, transparent)` }}
        >
          <motion.span
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={springBouncy}
            className="grid size-7 place-items-center rounded-xl text-white"
            style={{ background: meta.color }}
          >
            <meta.Icon weight="fill" className="size-4" />
          </motion.span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">
            {meta.label}
          </span>
          <span className="ml-auto flex items-center gap-1.5 font-serif text-[13px] italic text-ink/60">
            entendi assim
          </span>
        </div>

        <div className="px-4 pt-3 pb-2">
          <h3 className="stretch-title text-[23px] leading-[1.08]">{card.title}</h3>
          {card.summary && (
            <p className="mt-1.5 text-[13px] leading-snug text-ink/65">{card.summary}</p>
          )}

          <motion.ul
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } } }}
            className="mt-3.5 grid gap-1.5"
          >
            {card.fields.map((f) => {
              const FieldIcon = FIELD_ICON[f.key]
              return (
                <motion.li
                  key={f.key}
                  variants={{ hidden: { opacity: 0, x: -14 }, show: { opacity: 1, x: 0 } }}
                  transition={spring}
                  className="flex items-center gap-3 rounded-2xl bg-surface-2/70 px-3 py-2"
                >
                  <FieldIcon weight="duotone" className="size-5 shrink-0 text-ink/70" />
                  <span className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-ink/50">
                    {f.label}
                  </span>
                  {f.value ? (
                    <span className="min-w-0 flex-1 text-[14px] font-semibold tabular-nums">
                      {f.value}
                    </span>
                  ) : (
                    <span className="animate-pulse-soft rounded-full border border-dashed border-sun bg-sun/20 px-2.5 py-0.5 text-[12px] font-medium">
                      não informado
                    </span>
                  )}
                </motion.li>
              )
            })}
          </motion.ul>
        </div>

        <div className="flex gap-2 px-3 pt-1 pb-3">
          <motion.button
            ref={confirmBtn}
            onClick={() => void confirm(confirmBtn.current)}
            disabled={confirming}
            whileTap={{ scale: 0.95 }}
            whileHover={{ y: -2, rotate: -0.6 }}
            transition={springBouncy}
            aria-label={`Confirmar ${card.title}`}
            className="relative flex h-12 flex-[1.4] items-center justify-center gap-2 overflow-hidden rounded-2xl bg-ink font-semibold text-bg"
          >
            <AnimatePresence>
              {confirming && (
                <motion.span
                  initial={{ scale: 0, opacity: 1 }}
                  animate={{ scale: 6 }}
                  transition={{ duration: 0.34, ease: 'easeOut' }}
                  className="absolute left-1/2 top-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint"
                />
              )}
            </AnimatePresence>
            <span className="relative flex items-center gap-2">
              <motion.span
                animate={confirming ? { scale: [1, 1.5, 1], rotate: [0, -12, 0] } : {}}
                transition={{ duration: 0.3 }}
              >
                <Check weight="bold" className="size-5" />
              </motion.span>
              {confirming ? 'Pronto!' : 'Confirmar'}
            </span>
          </motion.button>

          <motion.button
            onClick={() => {
              haptic(8)
              void pressCard(`edit:${card.itemId}`)
            }}
            whileTap={{ scale: 0.95 }}
            whileHover={{ y: -2, rotate: 0.6 }}
            transition={springBouncy}
            aria-label={`Editar ${card.title}`}
            className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-ink/15 font-semibold"
          >
            <PencilSimple weight="bold" className="size-[18px]" />
            Editar
          </motion.button>

          <motion.button
            onClick={() => void discard()}
            whileTap={{ scale: 0.92 }}
            whileHover={{ y: -2 }}
            transition={springBouncy}
            aria-label={`Descartar ${card.title}`}
            className="grid size-12 shrink-0 place-items-center rounded-2xl text-ink/55 hover:bg-primary/10 hover:text-primary"
          >
            <Trash weight="duotone" className="size-5" />
          </motion.button>
        </div>
      </motion.div>
    </motion.article>
  )
}
