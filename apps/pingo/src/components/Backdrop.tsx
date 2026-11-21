/** Fundo vivo: três manchas de cor que derivam devagar atrás do aplicativo. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className="animate-drift-a absolute -top-32 -left-24 size-[460px] rounded-full bg-sun/45 blur-3xl" />
      <div className="animate-drift-b absolute -right-28 top-1/3 size-[420px] rounded-full bg-mint/30 blur-3xl" />
      <div className="animate-drift-c absolute -bottom-40 left-1/4 size-[520px] rounded-full bg-primary/25 blur-3xl" />
    </div>
  )
}
