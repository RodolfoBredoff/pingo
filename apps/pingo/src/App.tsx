import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect } from 'react'
import { acceptConsent, completeOnboarding, initApp } from './app/controller'
import { runSelfTest } from './app/devcheck'
import { useApp, type Tab } from './app/store'
import { ChatView } from './chat/ChatView'
import { Backdrop } from './components/Backdrop'
import { FxLayer } from './components/FxLayer'
import { Header } from './components/Header'
import { PingoMark } from './components/PingoMark'
import { TabBar } from './components/TabBar'
import { ToastHost } from './components/Toast'
import { spring } from './lib/motion'
import { AgendaView } from './views/AgendaView'
import { DevPanel } from './views/DevPanel'
import { Onboarding } from './views/Onboarding'
import { SettingsView } from './views/SettingsView'

const VIEWS: Record<Tab, () => React.JSX.Element> = {
  chat: ChatView,
  agenda: AgendaView,
  settings: SettingsView,
}

export default function App() {
  const phase = useApp((s) => s.phase)
  const reduce = useApp((s) => s.reduceMotion)

  useEffect(() => {
    void initApp()
  }, [])

  // Autoteste de desenvolvimento (só com VITE_PINGO_SELFTEST=1).
  useEffect(() => {
    if (!(import.meta.env.DEV && import.meta.env.VITE_PINGO_SELFTEST === '1')) return
    if (phase === 'onboarding') void completeOnboarding('Teste')
    if (phase === 'consent') void acceptConsent()
    if (phase === 'ready') void runSelfTest()
  }, [phase])

  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>
      <Backdrop />
      <div className="grid h-full place-items-center sm:p-5">
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg/70 backdrop-blur-sm sm:h-[min(900px,100%)] sm:max-w-[470px] sm:rounded-[40px] sm:border sm:border-line sm:shadow-pop">
          {phase === 'loading' && <Splash />}
          {phase === 'error' && <Failure />}
          {phase === 'onboarding' && <Onboarding />}
          {phase === 'consent' && <Onboarding mode="reconsent" />}
          {phase === 'ready' && <Ready />}
          <ToastHost />
        </div>
      </div>
      <DevPanel />
      <FxLayer />
    </MotionConfig>
  )
}

function Ready() {
  const tab = useApp((s) => s.tab)
  const direction = useApp((s) => s.direction)
  const View = VIEWS[tab]

  return (
    <>
      <Header />
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="popLayout" custom={direction} initial={false}>
          <motion.div
            key={tab}
            custom={direction}
            variants={{
              enter: (d: number) => ({ x: d * 32, opacity: 0, scale: 0.98 }),
              center: { x: 0, opacity: 1, scale: 1 },
              exit: (d: number) => ({
                x: d * -32,
                opacity: 0,
                scale: 0.98,
                transition: { duration: 0.16 },
              }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring}
            className="absolute inset-0"
          >
            <View />
          </motion.div>
        </AnimatePresence>
      </div>
      <TabBar />
    </>
  )
}

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-5">
        <PingoMark size={96} pinging />
        <p className="font-serif text-[17px] italic text-ink/60">acordando o Pingo…</p>
      </div>
    </div>
  )
}

function Failure() {
  const error = useApp((s) => s.error)
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div className="flex flex-col items-center gap-4">
        <PingoMark size={72} />
        <h1 className="stretch-title text-[28px]">algo travou na partida</h1>
        <p className="max-w-[320px] text-sm text-ink/65">{error}</p>
        <button
          onClick={() => location.reload()}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-bg"
        >
          Tentar de novo
        </button>
      </div>
    </div>
  )
}
