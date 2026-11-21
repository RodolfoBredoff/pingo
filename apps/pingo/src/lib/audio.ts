/**
 * Converte qualquer áudio que o navegador consiga decodificar em WAV mono 16 kHz.
 * Motivo: cada WebView grava num formato (Safari: m4a; Chromium: webm/opus) e os modelos
 * aceitam de forma confiável wav e mp3. Assim o app não depende do formato de gravação.
 */
export async function toWav(blob: Blob, targetRate = 16000): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer()
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(buf.slice(0))
  } finally {
    void ctx.close()
  }
  const length = Math.ceil(decoded.duration * targetRate)
  const offline = new OfflineAudioContext(1, length, targetRate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return encodeWav(rendered.getChannelData(0), targetRate)
}

function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  out.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true) // PCM
  out.setUint16(22, 1, true) // mono
  out.setUint32(24, rate, true)
  out.setUint32(28, rate * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  str(36, 'data')
  out.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => {
    const v = Math.max(-1, Math.min(1, s))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  })
  return new Uint8Array(out.buffer)
}

/** Miniatura JPEG pequena (data URL) para guardar no histórico do chat. */
export async function makeThumb(file: Blob, max = 220): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return undefined
  }
}
