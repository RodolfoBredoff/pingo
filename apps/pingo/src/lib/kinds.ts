import {
  CalendarStar,
  CheckSquareOffset,
  CurrencyCircleDollar,
  HourglassMedium,
  Info,
  Signature,
  type Icon,
} from '@phosphor-icons/react'
import type { ItemKind } from '@pingo/shared'

/** Cor e ícone por tipo de item. As cores vêm dos tokens, então acompanham o tema. */
export const KIND_META: Record<ItemKind, { label: string; color: string; Icon: Icon }> = {
  event: { label: 'Evento', color: 'var(--sky)', Icon: CalendarStar },
  deadline: { label: 'Prazo', color: 'var(--primary)', Icon: HourglassMedium },
  task: { label: 'Tarefa', color: 'var(--mint)', Icon: CheckSquareOffset },
  authorization: { label: 'Autorização', color: 'var(--sun)', Icon: Signature },
  payment: { label: 'Pagamento', color: 'var(--berry)', Icon: CurrencyCircleDollar },
  info: {
    label: 'Informação',
    color: 'color-mix(in srgb, var(--ink) 60%, transparent)',
    Icon: Info,
  },
}
