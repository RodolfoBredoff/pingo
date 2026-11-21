/** Física de movimento do Pingo (design.md §10). Molas curtas, saídas rápidas. */

export const spring = { type: 'spring', stiffness: 380, damping: 30 } as const
export const springSoft = { type: 'spring', stiffness: 240, damping: 26 } as const
export const springBouncy = { type: 'spring', stiffness: 520, damping: 20 } as const
export const exitFast = { duration: 0.15, ease: [0.4, 0, 1, 1] } as const

export const haptic = (ms = 10) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* sem vibração disponível */
  }
}
