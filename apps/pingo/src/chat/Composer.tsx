import {
  FilePdf,
  Image as ImageIcon,
  Microphone,
  PaperPlaneTilt,
  Paperclip,
  Stop,
  Trash,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { sendFile, sendRecording, sendText } from '../app/controller'
import { showToast, useApp } from '../app/store'
import { haptic, spring, springBouncy } from '../lib/motion'
import { useRecorder } from './useRecorder'

const SAMPLES: { label: string; text?: string }[] = [
  {
    label: 'Convite de aniversário',
    text: 'Convite! O aniversário da Sofia é sábado, às 15h, no Buffet Alegria, Rua das Flores 123. Confirmar presença com a Marina até quinta.',
  },
  {
    label: 'Aviso da escola',
    text: 'Oi famílias! Sexta-feira tem passeio ao zoológico. O Ravi precisa ir de tênis, boné e levar lanche. Autorização assinada até quarta.',
  },
  { label: 'Pedido por áudio' },
]

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Composer() {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const hasKey = useApp((s) => s.hasKey)
  const typing = useApp((s) => s.typing)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const rec = useRecorder()

  // Cresce com o texto, até 5 linhas.
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 124)}px`
  }, [text])

  const canSend = !!text.trim() || !!file

  async function submit() {
    if (!canSend) return
    const caption = text.trim()
    const f = file
    setText('')
    setFile(null)
    haptic()
    if (f) await sendFile(f, caption || undefined)
    else await sendText(caption)
  }

  async function startRecording() {
    haptic(12)
    const ok = await rec.start()
    if (!ok) showToast('Preciso da permissão do microfone.', 'warn')
  }

  async function finishRecording() {
    haptic(12)
    const r = await rec.stop()
    if (r) await sendRecording(r.blob, r.durationMs)
  }

  return (
    <div className="px-3 pt-1 pb-3">
      {/* atalhos */}
      {!rec.recording && !file && (
        <div className="scroll-soft -mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {SAMPLES.map((s, i) => (
            <motion.button
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.05 * i }}
              whileHover={{ y: -2, rotate: i % 2 ? 1 : -1 }}
              whileTap={{ scale: 0.94 }}
              onClick={() =>
                s.text ? (setText(s.text), area.current?.focus()) : void startRecording()
              }
              className="shrink-0 rounded-full border border-ink/15 bg-surface/80 px-3.5 py-1.5 text-[13px] font-semibold"
            >
              {s.label}
            </motion.button>
          ))}
        </div>
      )}

      {/* anexo escolhido */}
      <AnimatePresence>
        {file && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="mb-2 flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2">
              {file.type.startsWith('image/') ? (
                <ImageIcon weight="duotone" className="size-6 text-sky" />
              ) : file.type === 'application/pdf' ? (
                <FilePdf weight="duotone" className="size-6 text-primary" />
              ) : (
                <Microphone weight="duotone" className="size-6 text-berry" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
              <button
                aria-label="Remover anexo"
                onClick={() => setFile(null)}
                className="grid size-7 place-items-center rounded-full hover:bg-ink/10"
              >
                <X weight="bold" className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2 rounded-[30px] border border-line bg-surface p-1.5 shadow-card">
        <AnimatePresence mode="wait" initial={false}>
          {rec.recording ? (
            <motion.div
              key="rec"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={spring}
              className="flex min-h-12 flex-1 items-center gap-3 pl-2"
            >
              <button
                aria-label="Cancelar gravação"
                onClick={rec.cancel}
                className="grid size-10 place-items-center rounded-full text-ink/60 hover:bg-ink/10"
              >
                <Trash weight="duotone" className="size-5" />
              </button>
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-3 rounded-full bg-primary" />
              </span>
              <span className="w-11 font-mono text-sm tabular-nums">{fmt(rec.elapsedMs)}</span>
              <Waveform analyser={rec.analyser} />
              <motion.button
                aria-label="Parar e enviar áudio"
                onClick={() => void finishRecording()}
                whileTap={{ scale: 0.9 }}
                transition={springBouncy}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-white"
              >
                <Stop weight="fill" className="size-5" />
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="typing"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={spring}
              className="flex flex-1 items-end gap-1"
            >
              <input
                ref={picker}
                type="file"
                hidden
                accept="image/*,application/pdf,audio/*"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setFile(f)
                  e.target.value = ''
                }}
              />
              <motion.button
                aria-label="Anexar imagem, PDF ou áudio"
                onClick={() => picker.current?.click()}
                whileHover={{ rotate: -14 }}
                whileTap={{ scale: 0.88 }}
                transition={springBouncy}
                className="grid size-11 shrink-0 place-items-center rounded-full text-ink/65 hover:bg-ink/8"
              >
                <Paperclip weight="duotone" className="size-6" />
              </motion.button>
              <textarea
                ref={area}
                value={text}
                rows={1}
                disabled={hasKey === false}
                placeholder={
                  hasKey === false
                    ? 'Falta a chave do OpenRouter (Ajustes)'
                    : 'Cole ou escreva o recado…'
                }
                aria-label="Mensagem para o Pingo"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                className="max-h-[124px] min-h-11 flex-1 resize-none bg-transparent px-1 py-[11px] text-[15px] leading-snug outline-none placeholder:text-ink/40"
              />
              <AnimatePresence mode="wait" initial={false}>
                {canSend ? (
                  <motion.button
                    key="send"
                    aria-label="Enviar"
                    disabled={typing || hasKey === false}
                    onClick={() => void submit()}
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, rotate: 40 }}
                    whileTap={{ scale: 0.88 }}
                    transition={springBouncy}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-white disabled:opacity-50"
                  >
                    <PaperPlaneTilt weight="fill" className="size-5" />
                  </motion.button>
                ) : (
                  <motion.button
                    key="mic"
                    aria-label="Gravar áudio"
                    disabled={hasKey === false}
                    onClick={() => void startRecording()}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.88 }}
                    transition={springBouncy}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:opacity-40"
                  >
                    <Microphone weight="fill" className="size-5" />
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Onda ao vivo: as barras seguem o volume do microfone, sem re-renderizar o React. */
function Waveform({ analyser }: { analyser: AnalyserNode | null }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const COUNT = 28

  useEffect(() => {
    if (!analyser) return
    const data = new Uint8Array(analyser.fftSize)
    let raf = 0
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      const step = Math.floor(data.length / COUNT)
      for (let i = 0; i < COUNT; i++) {
        let peak = 0
        for (let j = 0; j < step; j++)
          peak = Math.max(peak, Math.abs((data[i * step + j] ?? 128) - 128))
        const h = 4 + Math.min(1, peak / 60) * 24
        const el = bars.current[i]
        if (el) el.style.height = `${h}px`
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return (
    <span aria-hidden className="flex h-8 flex-1 items-center justify-between gap-[2px]">
      {Array.from({ length: COUNT }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el
          }}
          className="w-[3px] rounded-full bg-primary/80 transition-[height] duration-75"
          style={{ height: 4 }}
        />
      ))}
    </span>
  )
}
