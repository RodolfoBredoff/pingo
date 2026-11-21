interface Props {
  size?: number
  /** Anéis de "ping" ao redor, usados na tela de carregamento. */
  pinging?: boolean
  className?: string
}

/**
 * Mascote do Pingo: uma gotinha-ovo coral com olhos que piscam e um brilho de "ping".
 * Desenho original do projeto.
 */
export function PingoMark({ size = 40, pinging = false, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Pingo"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {pinging && (
        <>
          <circle
            cx="32"
            cy="34"
            r="26"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            className="animate-ping-ring"
            style={{ transformOrigin: '32px 34px' }}
          />
          <circle
            cx="32"
            cy="34"
            r="26"
            fill="none"
            stroke="var(--sun)"
            strokeWidth="2"
            className="animate-ping-ring"
            style={{ transformOrigin: '32px 34px', animationDelay: '1.2s' }}
          />
        </>
      )}
      {/* corpo */}
      <path
        d="M32 6c13 0 24 10 24 25 0 15-11 27-24 27S8 46 8 31C8 16 19 6 32 6z"
        fill="var(--primary)"
      />
      {/* brilho */}
      <path
        d="M17 24c1-6 5-10 10-12"
        stroke="#fff"
        strokeOpacity=".55"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      {/* bochechas */}
      <circle cx="18.5" cy="40" r="4" fill="var(--sun)" opacity=".75" />
      <circle cx="45.5" cy="40" r="4" fill="var(--sun)" opacity=".75" />
      {/* olhos */}
      <g
        className="animate-blink"
        style={{ transformOrigin: '24px 31px', transformBox: 'fill-box' }}
      >
        <ellipse cx="24" cy="31" rx="5.2" ry="6.4" fill="#fff" />
        <circle cx="25.2" cy="32.2" r="2.8" fill="#2a1d13" />
      </g>
      <g
        className="animate-blink"
        style={{ transformOrigin: '40px 31px', transformBox: 'fill-box' }}
      >
        <ellipse cx="40" cy="31" rx="5.2" ry="6.4" fill="#fff" />
        <circle cx="41.2" cy="32.2" r="2.8" fill="#2a1d13" />
      </g>
      {/* sorriso */}
      <path
        d="M26 43c3.6 3.4 8.4 3.4 12 0"
        stroke="#2a1d13"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* faísca */}
      <path d="M51 6l1.8 4.6L57.5 12l-4.7 1.4L51 18l-1.8-4.6L44.5 12l4.7-1.4z" fill="var(--sun)" />
    </svg>
  )
}
