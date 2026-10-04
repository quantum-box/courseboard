import { PDFDocument, degrees } from 'pdf-lib'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createWorker } from 'tesseract.js'
import detectionWorkerUrl from 'tesseract.js/dist/worker.min.js?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type OrientationProgress = { completed: number; total: number }

/** OSD reports the clockwise correction, not the authored PDF rotation. */
export function confidentPageRotation(degrees: number | null, confidence: number | null): number {
  return confidence !== null && confidence >= 15 && [90, 180, 270].includes(degrees ?? -1)
    ? degrees! : 0
}

type Detection = { orientation_degrees: number | null; orientation_confidence: number | null }

export function pageRotations(detections: Detection[]): number[] {
  const strong = detections.filter(d => (d.orientation_confidence ?? 0) >= 15)
  const agreed = strong.length >= 2 && strong.every(d => d.orientation_degrees === strong[0].orientation_degrees)
    ? strong[0].orientation_degrees : null
  return detections.map(d => confidentPageRotation(d.orientation_degrees, d.orientation_confidence)
    || (agreed && d.orientation_degrees === agreed && (d.orientation_confidence ?? 0) >= 10 ? agreed : 0))
}

/** Analyze low-resolution copies locally; keep original page contents and quality. */
export async function orientPdf(file: File, onProgress?: (progress: OrientationProgress) => void): Promise<File> {
  const bytes = await file.arrayBuffer()
  const original = await PDFDocument.load(bytes)
  const task = getDocument({ data: new Uint8Array(bytes.slice(0)) })
  const pdf = await task.promise
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined
  let changed = false
  const detections: Detection[] = []
  try {
    onProgress?.({ completed: 0, total: pdf.numPages })
    worker = await createWorker('osd', 0, {
      workerPath: detectionWorkerUrl,
      legacyCore: true,
      legacyLang: true,
    })
    for (let index = 0; index < pdf.numPages; index += 1) {
      const page = await pdf.getPage(index + 1)
      const natural = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 1800 / Math.max(natural.width, natural.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      try {
        await page.render({ canvas, viewport }).promise
        const { data } = await worker.detect(canvas)
        detections.push(data)
      } finally {
        canvas.width = 0
        canvas.height = 0
        page.cleanup()
      }
      onProgress?.({ completed: index + 1, total: pdf.numPages })
    }
    for (const [index, rotation] of pageRotations(detections).entries()) {
      if (!rotation) continue
      const source = original.getPage(index)
      source.setRotation(degrees((source.getRotation().angle + rotation) % 360))
      changed = true
    }
    if (!changed) return file
    const corrected = await original.save()
    return new File([new Blob([corrected], { type: 'application/pdf' })], file.name, {
      type: file.type, lastModified: file.lastModified,
    })
  } finally {
    await worker?.terminate()
    await task.destroy()
  }
}
