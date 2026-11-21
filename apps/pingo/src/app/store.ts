import { create } from 'zustand'
import type { ContactRow, ItemRow, ItemStatus } from '@pingo/core'
import type { ChatEntry } from '../chat/types'

export type Tab = 'chat' | 'agenda' | 'settings'
export type ThemeMode = 'auto' | 'light' | 'dark'

export interface FxEvent {
  id: string
  kind: 'confetti' | 'fly'
  x: number
  y: number
  toX?: number
  toY?: number
  color?: string
}

export interface Toast {
  id: string
  text: string
  tone: 'ok' | 'warn' | 'error'
}

export interface LastRun {
  at: string
  role: string
  model: string
  json: string
}

export interface BackupState {
  /** Pasta escolhida para o backup automático. */
  dir: string | null
  auto: boolean
  everyDays: 1 | 7
  lastAt: string | null
  lastError: string | null
  busy: boolean
}

interface AppState {
  phase: 'loading' | 'onboarding' | 'consent' | 'ready' | 'error'
  error: string | null
  tab: Tab
  /** Direção da última troca de aba (para a animação de deslize). */
  direction: 1 | -1
  ownerName: string
  consentAt: string | null
  backup: BackupState
  entries: ChatEntry[]
  typing: boolean
  statuses: Record<string, ItemStatus>
  agenda: ItemRow[]
  contacts: ContactRow[]
  /** Iniciar com o computador (null = ainda não consultado ou indisponível). */
  autostart: boolean | null
  hasKey: boolean | null
  theme: ThemeMode
  reduceMotion: boolean
  toast: Toast | null
  fx: FxEvent[]
  devOpen: boolean
  clockOffsetMs: number
  spend: { today: number; month: number }
  lastRun: LastRun | null
}

export const useApp = create<AppState>(() => ({
  phase: 'loading',
  error: null,
  tab: 'chat',
  direction: 1,
  ownerName: '',
  consentAt: null,
  backup: { dir: null, auto: false, everyDays: 1, lastAt: null, lastError: null, busy: false },
  entries: [],
  typing: false,
  statuses: {},
  agenda: [],
  contacts: [],
  autostart: null,
  hasKey: null,
  theme: 'auto',
  reduceMotion: false,
  toast: null,
  fx: [],
  devOpen: false,
  clockOffsetMs: 0,
  spend: { today: 0, month: 0 },
  lastRun: null,
}))

export const setApp = useApp.setState
export const getApp = useApp.getState

const TAB_ORDER: Tab[] = ['chat', 'agenda', 'settings']

export function goTab(tab: Tab) {
  const cur = getApp().tab
  if (cur === tab) return
  setApp({ tab, direction: TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(cur) ? 1 : -1 })
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
export function showToast(text: string, tone: Toast['tone'] = 'ok') {
  clearTimeout(toastTimer)
  setApp({ toast: { id: crypto.randomUUID(), text, tone } })
  toastTimer = setTimeout(() => setApp({ toast: null }), 3200)
}

export function pushFx(e: Omit<FxEvent, 'id'>) {
  setApp((s) => ({ fx: [...s.fx, { ...e, id: crypto.randomUUID() }] }))
}
export function dropFx(id: string) {
  setApp((s) => ({ fx: s.fx.filter((f) => f.id !== id) }))
}
