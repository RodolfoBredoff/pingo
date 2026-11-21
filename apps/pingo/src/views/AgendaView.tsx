import { Check, MapPin, UserCircle, X } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { formatWhen, groupByLocalDay, localDate, type ItemRow } from '@pingo/core'
import { agendaAction, ownerTz, virtualNow } from '../app/controller'
import { goTab, useApp } from '../app/store'
import { PingoMark } from '../components/PingoMark'
import { KIND_META } from '../lib/kinds'
import { spring, springBouncy } from '../lib/motion'

type Filter = 'agenda' | 'pending' | 'done'

function dayTitle(date: string | null, tz: string): string {
  if (!date) return 'Sem data'
  const now = virtualNow()
  if (date === localDate(now, tz)) return 'Hoje'
  if (date === localDate(new Date(now.getTime() + 86_400_000), tz)) return 'Amanhã'
  const d = new Date(`${date}T12:00:00Z`)
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d)
}

export function AgendaView() {
  const agenda = useApp((s) => s.agenda)
  const [filter, setFilter] = useState<Filter>('agenda')
  const tz = ownerTz()

  const rows = useMemo(
    () =>
      agenda.filter(
        (i) =>
          i.status ===
          (filter === 'agenda' ? 'confirmed' : filter === 'pending' ? 'proposed' : 'done'),
      ),
    [agenda, filter],
  )
  const days = useMemo(() => groupByLocalDay(rows, tz), [rows, tz])
  const pendingCount = agenda.filter((i) => i.status === 'proposed').length

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-2 pb-3">
        <h2 className="stretch-title text-[34px] leading-none">agenda</h2>
        <p className="mt-1 font-serif text-[14px] italic text-ink/60">o que já está combinado</p>

        <div role="tablist" className="relative mt-4 flex rounded-full bg-ink/8 p-1">
          {(
            [
              ['agenda', 'Na agenda'],
              ['pending', `Pendentes${pendingCount ? ` · ${pendingCount}` : ''}`],
              ['done', 'Feitos'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className="relative flex-1 rounded-full py-2 text-[13px] font-semibold"
            >
              {filter === id && (
                <motion.span
                  layoutId="agenda-filter"
                  transition={springBouncy}
                  className="absolute inset-0 rounded-full bg-surface shadow-card"
                />
              )}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {days.length === 0 ? (
          <Empty filter={filter} />
        ) : (
          days.map((day, di) => (
            <section key={day.date ?? 'none'} className="mb-5">
              <h3 className="sticky top-0 z-10 -mx-1 mb-2 bg-bg/80 px-1 py-1 font-serif text-[17px] italic capitalize backdrop-blur">
                {dayTitle(day.date, tz)}
              </h3>
              <ul className="grid gap-2">
                {day.items.map((item, i) => (
                  <Row
                    key={item.id}
                    item={item}
                    tz={tz}
                    filter={filter}
                    delay={(di * 2 + i) * 0.04}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function Row({
  item,
  tz,
  filter,
  delay,
}: {
  item: ItemRow
  tz: string
  filter: Filter
  delay: number
}) {
  const meta = KIND_META[item.kind]
  const contacts = useApp((s) => s.contacts)
  const assignee = item.assigneeContactId
    ? contacts.find((c) => c.id === item.assigneeContactId)
    : undefined
  const ref = item.startsAt ?? item.dueAt
  const when = ref
    ? `${item.startsAt ? '' : 'até '}${item.allDay ? 'dia todo' : formatWhen(ref, tz, false).split('· ')[1]}`
    : 'sem data'

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, x: 40 }}
      transition={{ ...spring, delay }}
      className="flex items-center gap-2 rounded-[22px] border border-line bg-surface py-2.5 pr-2.5 pl-3.5 shadow-card"
    >
      <button
        onClick={() => filter === 'pending' && goTab('chat')}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className="grid size-11 shrink-0 place-items-center rounded-2xl text-white"
          style={{ background: meta.color, opacity: filter === 'done' ? 0.5 : 1 }}
        >
          <meta.Icon weight="fill" className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={
              'block truncate font-display text-[17px] font-bold leading-tight ' +
              (filter === 'done' ? 'text-ink/50 line-through' : '')
            }
          >
            {item.title}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-[12px] text-ink/60">
            <span className="font-mono tabular-nums">{when}</span>
            {item.location && (
              <span className="flex min-w-0 items-center gap-0.5">
                <MapPin weight="fill" className="size-3.5 shrink-0" />
                <span className="truncate">{item.location}</span>
              </span>
            )}
            {assignee && (
              <span className="flex shrink-0 items-center gap-0.5">
                <UserCircle weight="fill" className="size-3.5" />
                {assignee.name.split(' ')[0]}
              </span>
            )}
          </span>
        </span>
        {filter === 'pending' && (
          <span className="animate-pulse-soft shrink-0 rounded-full bg-sun/30 px-2.5 py-1 text-[11px] font-semibold">
            aguardando você
          </span>
        )}
      </button>
      {filter === 'agenda' && (
        <span className="flex shrink-0 gap-1.5">
          <motion.button
            aria-label={`Marcar "${item.title}" como feito`}
            title="Feito"
            whileTap={{ scale: 0.85 }}
            whileHover={{ scale: 1.08 }}
            transition={springBouncy}
            onClick={() => void agendaAction('done', item.id)}
            className="grid size-10 place-items-center rounded-full bg-mint/25 text-ink"
          >
            <Check weight="bold" className="size-5" />
          </motion.button>
          <motion.button
            aria-label={`Cancelar "${item.title}"`}
            title="Cancelar item"
            whileTap={{ scale: 0.85 }}
            whileHover={{ scale: 1.08 }}
            transition={springBouncy}
            onClick={() => void agendaAction('cancel_item', item.id)}
            className="grid size-10 place-items-center rounded-full bg-ink/8 text-ink/70"
          >
            <X weight="bold" className="size-5" />
          </motion.button>
        </span>
      )}
    </motion.li>
  )
}

function Empty({ filter }: { filter: Filter }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="grid h-full min-h-[320px] place-items-center text-center"
    >
      <div className="flex flex-col items-center gap-4 px-8">
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <PingoMark size={84} />
        </motion.div>
        <p className="stretch-title text-[26px] leading-tight">
          {filter === 'agenda'
            ? 'Nada por aqui ainda.'
            : filter === 'pending'
              ? 'Nada esperando você.'
              : 'Nada feito ainda.'}
        </p>
        <p className="font-serif text-[15px] italic text-ink/60">
          {filter === 'agenda'
            ? 'Manda um recado na conversa e confirma o cartão: ele aparece aqui.'
            : filter === 'pending'
              ? 'Quando o Pingo entender algo, o cartão fica aqui até você decidir.'
              : 'O que você concluir aparece aqui.'}
        </p>
        <button
          onClick={() => goTab('chat')}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-bg"
        >
          Ir para a conversa
        </button>
      </div>
    </motion.div>
  )
}
