import { FilePdf, Microphone } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { localTime } from '@pingo/core'
import type { ItemStatus } from '@pingo/core'
import { ownerTz } from '../app/controller'
import { pressListRow, pressReply } from '../app/controller'
import { spring } from '../lib/motion'
import { ItemCardView } from './ItemCardView'
import { QuickReplies } from './QuickReplies'
import { RichText } from './RichText'
import type { ChatEntry } from './types'

interface Props {
  entry: ChatEntry
  status: ItemStatus | undefined
  superseded: boolean
}

const fmtDuration = (ms?: number) => {
  const s = Math.round((ms ?? 0) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Barras fixas que lembram uma onda de áudio (decorativas). */
const BARS = [6, 12, 18, 9, 22, 14, 8, 20, 11, 16, 7, 19, 13, 9, 17, 10, 21, 8, 15, 6]

export function Bubble({ entry, status, superseded }: Props) {
  const mine = entry.sender === 'user'
  const { body } = entry
  const time = localTime(entry.at, ownerTz())

  // O cartão ocupa a largura toda e tem o próprio comportamento.
  if (body.type === 'card') {
    return (
      <Appear mine={false} wide>
        <ItemCardView card={body.card} status={status} superseded={superseded} />
      </Appear>
    )
  }

  const audience = entry.audience
  return (
    <Appear mine={mine}>
      {entry.via === 'whatsapp' && (
        <span className="mb-1 block text-right font-mono text-[10.5px] text-ink/50">
          pelo WhatsApp
        </span>
      )}
      {audience && (
        <span
          className={`mb-1 block font-mono text-[10.5px] text-ink/50 ${mine ? 'text-right' : ''}`}
        >
          {mine
            ? `${audience.name} respondeu (simulado)`
            : `📨 mensagem simulada para ${audience.name}`}
        </span>
      )}
      <div
        className={
          mine
            ? `rounded-[22px] rounded-br-md px-4 py-2.5 shadow-card ${audience ? 'bg-ink text-bg' : 'bg-primary text-white'}`
            : `rounded-[22px] rounded-bl-md border bg-surface px-4 py-2.5 shadow-card ${audience ? 'border-dashed border-ink/30' : 'border-line'}`
        }
      >
        {body.type === 'text' && (
          <p className="whitespace-pre-wrap text-[15px] leading-[1.45]">
            <RichText text={body.text} />
          </p>
        )}

        {body.type === 'attachment' && (
          <div className="grid gap-2">
            {body.kind === 'image' &&
              (body.thumb ? (
                <img
                  src={body.thumb}
                  alt={body.name}
                  className="max-h-52 rounded-2xl object-cover"
                />
              ) : (
                <div className="grid h-24 place-items-center rounded-2xl bg-white/20 text-sm">
                  {body.name}
                </div>
              ))}
            {body.kind === 'pdf' && (
              <div className="flex items-center gap-3 rounded-2xl bg-white/20 px-3 py-2.5">
                <FilePdf weight="duotone" className="size-8" />
                <span className="min-w-0 truncate text-sm font-semibold">{body.name}</span>
              </div>
            )}
            {body.kind === 'audio' && (
              <div className="flex items-center gap-3 rounded-2xl bg-white/20 px-3 py-2.5">
                <Microphone weight="fill" className="size-5" />
                <span className="flex h-6 items-center gap-[3px]" aria-hidden>
                  {BARS.map((h, i) => (
                    <span
                      key={i}
                      className="w-[3px] rounded-full bg-white/80"
                      style={{ height: h }}
                    />
                  ))}
                </span>
                <span className="font-mono text-xs">{fmtDuration(body.durationMs)}</span>
              </div>
            )}
            {body.caption && (
              <p className="whitespace-pre-wrap text-[15px] leading-[1.45]">{body.caption}</p>
            )}
          </div>
        )}

        {body.type === 'buttons' && (
          <>
            <p className="whitespace-pre-wrap text-[15px] leading-[1.45]">
              <RichText text={body.text} />
            </p>
            <QuickReplies
              buttons={body.buttons}
              pressed={body.pressed}
              onPress={(b) => void pressReply(entry.id, b.id, b.title, audience?.phone)}
            />
          </>
        )}

        {body.type === 'list' && (
          <>
            <p className="whitespace-pre-wrap text-[15px] leading-[1.45]">
              <RichText text={body.text} />
            </p>
            <ul className="mt-2 grid gap-1">
              {body.rows.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => void pressListRow(r.id, r.title)}
                    className="block w-full rounded-xl bg-surface-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-primary/10 active:scale-[0.98]"
                  >
                    <span className="font-semibold">{r.title}</span>
                    {r.description && (
                      <span className="block text-xs text-ink/60">{r.description}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <span
          className={`mt-1 block text-right font-mono text-[10px] ${mine ? 'text-white/70' : 'text-ink/40'}`}
        >
          {time}
        </span>
      </div>
    </Appear>
  )
}

/** Entrada animada: a bolha cresce a partir do lado de quem fala. */
function Appear({
  mine,
  wide,
  children,
}: {
  mine: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 16, scale: 0.9, x: wide ? 0 : mine ? 22 : -22 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      transition={spring}
      style={{ originX: mine ? 1 : 0, originY: 1 }}
      className={wide ? 'w-full' : mine ? 'ml-auto max-w-[86%]' : 'mr-auto max-w-[88%]'}
    >
      {children}
    </motion.div>
  )
}
