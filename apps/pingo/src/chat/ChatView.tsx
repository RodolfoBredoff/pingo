import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { localDate, localTime } from '@pingo/core'
import { ownerTz, virtualNow } from '../app/controller'
import { useApp } from '../app/store'
import { Bubble } from './Bubble'
import { Composer } from './Composer'
import { TypingIndicator } from './TypingIndicator'

function dayLabel(date: string, tz: string): string {
  const now = virtualNow()
  const today = localDate(now, tz)
  const yesterday = localDate(new Date(now.getTime() - 86_400_000), tz)
  if (date === today) return 'Hoje'
  if (date === yesterday) return 'Ontem'
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}`
}

export function ChatView() {
  const entries = useApp((s) => s.entries)
  const statuses = useApp((s) => s.statuses)
  const typing = useApp((s) => s.typing)
  const scroller = useRef<HTMLDivElement>(null)
  const tz = ownerTz()

  // Último cartão de cada item: os anteriores viram "versão anterior" depois de uma edição.
  const latestCard = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of entries) if (e.body.type === 'card') map.set(e.body.card.itemId, e.id)
    return map
  }, [entries])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // Espera o layout assentar para rolar até o fim.
    const id = requestAnimationFrame(() =>
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }),
    )
    return () => cancelAnimationFrame(id)
  }, [entries.length, typing])

  // Quais mensagens abrem um dia novo (para o separador "Hoje", "Ontem"…).
  const dayStarts = entries.map(
    (e, i) => i === 0 || localDate(e.at, tz) !== localDate(entries[i - 1]!.at, tz),
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-label="Conversa com o Pingo"
        className="scroll-soft flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-2 pb-3"
      >
        {entries.map((e, i) => {
          const day = localDate(e.at, tz)
          const showDay = dayStarts[i]
          return (
            <div key={e.id} className="flex flex-col gap-2.5">
              {showDay && (
                <div
                  className="mx-auto my-1 rounded-full bg-ink/8 px-3 py-1 font-mono text-[11px] text-ink/60"
                  title={localTime(e.at, tz)}
                >
                  {dayLabel(day, tz)}
                </div>
              )}
              <Bubble
                entry={e}
                status={e.body.type === 'card' ? statuses[e.body.card.itemId] : undefined}
                superseded={e.body.type === 'card' && latestCard.get(e.body.card.itemId) !== e.id}
              />
            </div>
          )
        })}
        <AnimatePresence>{typing && <TypingIndicator key="typing" />}</AnimatePresence>
      </div>
      <Composer />
    </div>
  )
}
