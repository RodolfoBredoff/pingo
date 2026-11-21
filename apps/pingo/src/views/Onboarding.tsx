import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  HardDrives,
  LockSimple,
  Sparkle,
  Trash,
  UsersThree,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ComponentType } from 'react'
import { acceptConsent, completeOnboarding, parseOwnerPhone } from '../app/controller'
import { useApp } from '../app/store'
import { PingoMark } from '../components/PingoMark'
import { spring, springBouncy } from '../lib/motion'

/**
 * Cadastro em dois passos: nome (e WhatsApp, opcional) e consentimento.
 * `reconsent`: quem já usava antes do texto de consentimento só vê o segundo passo.
 * Se mudar o texto abaixo, suba CONSENT_VERSION em packages/core/src/domain/privacy.ts.
 */
export function Onboarding({ mode = 'new' }: { mode?: 'new' | 'reconsent' }) {
  const existingName = useApp((s) => s.ownerName)
  const [step, setStep] = useState<'who' | 'consent'>(mode === 'new' ? 'who' : 'consent')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)

  function next() {
    if (!name.trim()) return
    if (!parseOwnerPhone(phone).ok) {
      setPhoneError(true)
      return
    }
    setPhoneError(false)
    setStep('consent')
  }

  async function finish() {
    if (!agreed || busy) return
    setBusy(true)
    if (mode === 'new') await completeOnboarding(name, phone)
    else await acceptConsent()
  }

  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex h-full min-h-0 flex-col"
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === 'who' ? (
          <motion.section
            key="who"
            initial={{ x: -30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -30, opacity: 0, transition: { duration: 0.14 } }}
            transition={spring}
            className="scroll-soft flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-8 text-center"
          >
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={springBouncy}
            >
              <PingoMark size={104} pinging />
            </motion.div>

            <div>
              <h1 className="stretch-title text-[44px] leading-[0.95]">
                oi! eu sou
                <br />o pingo.
              </h1>
              <p className="mx-auto mt-3 max-w-[300px] font-serif text-[17px] italic text-ink/70">
                Você me manda o recado, eu separo datas, tarefas e responsáveis.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                next()
              }}
              className="flex w-full max-w-[320px] flex-col gap-3"
            >
              <label className="text-left text-sm font-semibold">
                Como posso te chamar?
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  placeholder="Seu nome"
                  className="mt-1.5 h-13 w-full rounded-2xl border border-line bg-surface px-4 text-[17px] font-medium outline-none focus:border-primary"
                />
              </label>
              <label className="text-left text-sm font-semibold">
                Seu WhatsApp{' '}
                <span className="font-normal text-ink/50">(pode deixar para depois)</span>
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    setPhoneError(false)
                  }}
                  inputMode="tel"
                  placeholder="11 98888-7777"
                  aria-invalid={phoneError}
                  className={
                    'mt-1.5 h-13 w-full rounded-2xl border bg-surface px-4 font-mono text-[16px] outline-none focus:border-primary ' +
                    (phoneError ? 'border-primary' : 'border-line')
                  }
                />
                <span className="mt-1 block text-[12px] font-normal text-ink/55">
                  {phoneError
                    ? 'Não entendi esse número. Use o DDD, por exemplo 11 98888-7777.'
                    : 'Só será usado quando você ligar o WhatsApp. Por enquanto você conversa comigo aqui.'}
                </span>
              </label>
              <motion.button
                type="submit"
                disabled={!name.trim()}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                transition={springBouncy}
                className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-ink text-[17px] font-semibold text-bg disabled:opacity-40"
              >
                Continuar
                <ArrowRight weight="bold" className="size-5" />
              </motion.button>
            </form>
          </motion.section>
        ) : (
          <motion.section
            key="consent"
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 30, opacity: 0, transition: { duration: 0.14 } }}
            transition={spring}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-6 pt-8 pb-3">
              {mode === 'new' && (
                <button
                  onClick={() => setStep('who')}
                  className="mb-2 flex items-center gap-1 text-sm font-semibold text-ink/60"
                >
                  <ArrowLeft weight="bold" className="size-4" /> Voltar
                </button>
              )}
              <h1 className="stretch-title text-[34px] leading-[0.98]">
                antes de
                <br />
                começar{mode === 'reconsent' && existingName ? `, ${existingName}` : ''}
              </h1>
              <p className="mt-2 font-serif text-[15px] italic text-ink/65">
                Combinado claro: é assim que cuido do que você me manda.
              </p>

              <ul className="mt-5 grid gap-3">
                <Point Icon={HardDrives} title="Seus dados ficam neste aparelho">
                  Agenda, contatos e conversa ficam num banco guardado só aqui. Nenhum site, nenhuma
                  conta.
                </Point>
                <Point Icon={Sparkle} title="A IA lê o que você me manda">
                  Para entender um recado, envio o texto, a imagem, o PDF ou o áudio ao OpenRouter,
                  só para provedores que não guardam nem treinam com seus dados. Nada vira
                  compromisso sem você confirmar.
                </Point>
                <Point Icon={Cloud} title="Na nuvem, só o necessário e por pouco tempo">
                  Quando você ligar o WhatsApp, uma caixa de correio temporária guarda as mensagens
                  até o app buscá-las, e os lembretes ficam agendados. Sua agenda não vai para lá.
                </Point>
                <Point Icon={UsersThree} title="Contatos só recebem se aceitarem">
                  Antes de mandar qualquer coisa para alguém, peço permissão a essa pessoa.
                </Point>
                <Point Icon={Trash} title="Você manda em tudo">
                  Em Ajustes você exporta um backup ou apaga tudo, quando quiser. Também dá para
                  escrever “apagar meus dados” para mim.
                </Point>
              </ul>
            </div>

            <div className="border-t border-line bg-bg/80 px-6 pt-3 pb-5 backdrop-blur">
              <label className="flex cursor-pointer items-start gap-3 text-[14px] font-semibold">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={agreed}
                  onClick={() => setAgreed((v) => !v)}
                  className={
                    'mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border-2 transition-colors ' +
                    (agreed ? 'border-ink bg-ink text-bg' : 'border-ink/30 bg-surface')
                  }
                >
                  <AnimatePresence>
                    {agreed && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                        transition={springBouncy}
                      >
                        <Check weight="bold" className="size-4" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
                <span>Entendi e concordo com isso.</span>
              </label>
              <motion.button
                disabled={!agreed || busy}
                onClick={() => void finish()}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                transition={springBouncy}
                className="mt-3 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-[17px] font-semibold text-bg disabled:opacity-40"
              >
                <LockSimple weight="fill" className="size-5" />
                {busy ? 'Preparando…' : 'Concordar e começar'}
              </motion.button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </motion.main>
  )
}

function Point({
  Icon,
  title,
  children,
}: {
  Icon: ComponentType<{ weight?: 'fill' | 'duotone'; className?: string }>
  title: string
  children: string
}) {
  return (
    <li className="flex gap-3 rounded-[22px] border border-line bg-surface p-3.5 shadow-card">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sun/30">
        <Icon weight="duotone" className="size-6" />
      </span>
      <span>
        <span className="block font-display text-[16px] font-bold leading-tight">{title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-snug text-ink/70">{children}</span>
      </span>
    </li>
  )
}
