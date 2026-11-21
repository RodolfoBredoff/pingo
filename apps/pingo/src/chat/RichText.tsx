import { Fragment } from 'react'

/** Texto estilo WhatsApp: *negrito*. Sem HTML: o conteúdo nunca é interpretado como marcação. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.length > 2 && p.startsWith('*') && p.endsWith('*') ? (
          <strong key={i} className="font-bold">
            {p.slice(1, -1)}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}
