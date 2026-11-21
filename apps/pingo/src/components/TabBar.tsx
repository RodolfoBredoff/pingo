import { CalendarDots, ChatCircleDots, GearSix, type Icon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { goTab, useApp, type Tab } from '../app/store'
import { springBouncy } from '../lib/motion'

const TABS: { id: Tab; label: string; Icon: Icon }[] = [
  { id: 'chat', label: 'Conversa', Icon: ChatCircleDots },
  { id: 'agenda', label: 'Agenda', Icon: CalendarDots },
  { id: 'settings', label: 'Ajustes', Icon: GearSix },
]

export const AGENDA_BUMP_EVENT = 'pingo:agenda-bump'

export function TabBar() {
  const tab = useApp((s) => s.tab)
  const confirmed = useApp((s) => s.agenda.filter((i) => i.status === 'confirmed').length)
  const [bump, setBump] = useState(0)

  // Quando um cartão "voa" até a Agenda, o ícone dá um pulinho.
  useEffect(() => {
    const on = () => setBump((b) => b + 1)
    window.addEventListener(AGENDA_BUMP_EVENT, on)
    return () => window.removeEventListener(AGENDA_BUMP_EVENT, on)
  }, [])

  return (
    <nav
      aria-label="Seções"
      className="mx-4 mb-4 flex rounded-[28px] border border-line bg-surface/90 p-1.5 shadow-card backdrop-blur"
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = tab === id
        return (
          <button
            key={id}
            onClick={() => goTab(id)}
            aria-current={active ? 'page' : undefined}
            className="relative flex flex-1 flex-col items-center gap-0.5 rounded-[22px] py-2 text-[11px] font-semibold"
          >
            {active && (
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-[22px] bg-primary/15"
                transition={springBouncy}
              />
            )}
            <motion.span
              id={id === 'agenda' ? 'tab-agenda-icon' : undefined}
              key={id === 'agenda' ? `a${bump}` : id}
              initial={id === 'agenda' && bump > 0 ? { scale: 0.6, rotate: -12 } : false}
              animate={{ scale: 1, rotate: 0 }}
              transition={springBouncy}
              className="relative"
            >
              <Icon
                weight={active ? 'fill' : 'duotone'}
                className={active ? 'size-6 text-primary' : 'size-6 text-ink/70'}
              />
              <AnimatePresence>
                {id === 'agenda' && confirmed > 0 && (
                  <motion.span
                    key={confirmed}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={springBouncy}
                    className="absolute -top-1.5 -right-2.5 grid min-w-[18px] place-items-center rounded-full bg-ink px-1 font-mono text-[10px] text-bg"
                  >
                    {confirmed}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.span>
            <span className={active ? 'relative text-ink' : 'relative text-ink/60'}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
