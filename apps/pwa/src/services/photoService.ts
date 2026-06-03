import type * as Blazeface from '@tensorflow-models/blazeface'
import { signNip98AuthEvent } from './nostrService'

const MAX_DIMENSION = 800
const JPEG_QUALITY = 0.85
const BLUR_SCALE = 0.05 // scale face region down then up for pixelate blur

let faceModel: Blazeface.BlazeFaceModel | null = null

async function getFaceModel(): Promise<Blazeface.BlazeFaceModel> {
  if (!faceModel) {
    const blazeface = await import('@tensorflow-models/blazeface')
    faceModel = await blazeface.load()
  }
  return faceModel
}

export async function compressAndStrip(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context')
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null')),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

export async function blurFaces(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const model = await getFaceModel()
  const predictions = await model.estimateFaces(canvas, false)

  if (predictions.length === 0) return canvas

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  for (const pred of predictions) {
    const [x, y] = pred.topLeft as [number, number]
    const [x2, y2] = pred.bottomRight as [number, number]
    const fw = x2 - x
    const fh = y2 - y

    // Pixelate-blur: scale region down then back up without smoothing
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, Math.round(fw * BLUR_SCALE))
    tmp.height = Math.max(1, Math.round(fh * BLUR_SCALE))
    const tmpCtx = tmp.getContext('2d')
    if (!tmpCtx) continue
    tmpCtx.drawImage(canvas, x, y, fw, fh, 0, 0, tmp.width, tmp.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, fw, fh)
    ctx.imageSmoothingEnabled = true
  }

  return canvas
}

// Upload via the gateway proxy (/api/photos/pin). The Pinata credential lives
// only on the server — it is never exposed to the browser. NIP-98 authenticated.
export async function uploadToIPFS(blob: Blob): Promise<string | null> {
  try {
    const base = import.meta.env['VITE_API_BASE_URL'] ?? ''
    const url = new URL('/api/photos/pin', base || window.location.origin).toString()
    const authEvent = await signNip98AuthEvent(url, 'POST')
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Nostr-Auth': JSON.stringify(authEvent),
      },
      body: blob,
    })
    if (!res.ok) return null
    const data = await res.json() as { cid: string }
    return data.cid ?? null
  } catch {
    return null
  }
}
