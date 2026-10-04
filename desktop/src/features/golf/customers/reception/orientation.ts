import { degrees, PDFDocument } from 'pdf-lib'

const MAX_IMAGE_EDGE = 3000
const JPEG_QUALITY = 0.9

export type ReceptionRotation = 0 | 90 | 180 | 270

/** Preserves PDF page orientation and normalizes image orientation. */
export async function autoOrientReceptionSheet(file: File): Promise<File> {
  // Page dimensions cannot distinguish an upright scan from an upside-down one.
  // Keep the author-provided PDF rotation; operators can turn it explicitly.
  if (file.type === 'application/pdf') return file
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return file

  const exifOrientation = file.type === 'image/jpeg' ? await jpegExifOrientation(file) : 1
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const rotation: ReceptionRotation = bitmap.width > bitmap.height ? 90 : 0
    if (rotation === 0 && exifOrientation === 1) return file
    return encodeRotatedImage(bitmap, rotation, file)
  } finally {
    bitmap.close()
  }
}

/** Applies an operator-selected quarter turn to an image or every PDF page. */
export async function rotateReceptionSheet(
  file: File,
  rotation: ReceptionRotation,
): Promise<File> {
  if (rotation === 0) return file
  if (file.type === 'application/pdf') return rotatePdf(file, rotation)
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return file

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    return encodeRotatedImage(bitmap, rotation, file)
  } finally {
    bitmap.close()
  }
}

async function rotatePdf(file: File, rotation: ReceptionRotation): Promise<File> {
  const document = await PDFDocument.load(await file.arrayBuffer())
  for (const page of document.getPages()) {
    const current = normalizeAngle(page.getRotation().angle)
    page.setRotation(degrees((current + rotation) % 360))
  }
  return savePdf(document, file)
}

async function savePdf(document: PDFDocument, source: File): Promise<File> {
  const bytes = await document.save()
  return new File([new Blob([bytes], { type: 'application/pdf' })], source.name, {
    lastModified: source.lastModified,
    type: 'application/pdf',
  })
}

function normalizeAngle(angle: number): ReceptionRotation {
  const normalized = ((angle % 360) + 360) % 360
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized
  return 0
}

function encodeRotatedImage(
  bitmap: ImageBitmap,
  rotation: ReceptionRotation,
  source: File,
): Promise<File> {
  const sideways = rotation === 90 || rotation === 270
  const unscaledWidth = sideways ? bitmap.height : bitmap.width
  const unscaledHeight = sideways ? bitmap.width : bitmap.height
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(unscaledWidth, unscaledHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(unscaledWidth * scale))
  canvas.height = Math.max(1, Math.round(unscaledHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('2d context unavailable'))

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate((rotation * Math.PI) / 180)
  context.drawImage(
    bitmap,
    (-bitmap.width * scale) / 2,
    (-bitmap.height * scale) / 2,
    bitmap.width * scale,
    bitmap.height * scale,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('canvas produced no JPEG'))
      resolve(new File([blob], source.name, { lastModified: source.lastModified, type: 'image/jpeg' }))
    }, 'image/jpeg', JPEG_QUALITY)
  })
}

async function jpegExifOrientation(file: File): Promise<number> {
  const bytes = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer())
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2

  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break

    const segmentLength = view.getUint16(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break
    const payload = offset + 2
    if (
      marker === 0xe1
      && payload + 14 <= bytes.length
      && bytes[payload] === 0x45
      && bytes[payload + 1] === 0x78
      && bytes[payload + 2] === 0x69
      && bytes[payload + 3] === 0x66
      && bytes[payload + 4] === 0
      && bytes[payload + 5] === 0
    ) {
      return readTiffOrientation(view, payload + 6)
    }
    offset += segmentLength
  }
  return 1
}

function readTiffOrientation(view: DataView, start: number): number {
  if (start + 8 > view.byteLength) return 1
  const littleEndian = view.getUint16(start) === 0x4949
  if (!littleEndian && view.getUint16(start) !== 0x4d4d) return 1
  if (view.getUint16(start + 2, littleEndian) !== 42) return 1

  const directory = start + view.getUint32(start + 4, littleEndian)
  if (directory + 2 > view.byteLength) return 1
  const count = view.getUint16(directory, littleEndian)
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12
    if (entry + 12 > view.byteLength) return 1
    if (view.getUint16(entry, littleEndian) === 0x0112) {
      if (view.getUint16(entry + 2, littleEndian) !== 3) return 1
      return view.getUint16(entry + 8, littleEndian)
    }
  }
  return 1
}
