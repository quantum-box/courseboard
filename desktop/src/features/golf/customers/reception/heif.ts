/**
 * 受付用紙の写真を、読み取りに出せる JPEG にするところ。
 *
 * ブラウザ固有の API（HEIC のデコーダ・canvas）に触るのはこのファイルだけで、
 * どの形式を通すかの判断は `models.ts` が持つ。
 */

/** JPEG quality used for the format conversion. */
const SHEET_JPEG_QUALITY = 0.9
const MAX_HEIF_DIMENSION = 3000

/** The picked photo as a JPEG, decoded whichever way this browser can. */
export async function heifToJpeg(file: File): Promise<File> {
  const bitmap = await decode(file)
  try {
    return await encodeJpeg(bitmap, file.lastModified)
  } finally {
    bitmap.close()
  }
}

/**
 * Native decoder first, a bundled one only if there is no other way.
 *
 * Safari and iOS read HEIC themselves, in a fraction of a second — a desk
 * working on the iPad it took the photo with never downloads a decoder at all.
 * Everywhere else it is libheif behind a worker, imported here so that a desk
 * working from scans never pays for it either.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    // Not a browser that knows HEIC; fall through to the bundled decoder.
  }
  const { heicTo } = await import('heic-to')
  return heicTo({ blob: file, type: 'bitmap' })
}

function encodeJpeg(bitmap: ImageBitmap, lastModified: number): Promise<File> {
  const scale = Math.min(1, MAX_HEIF_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2d context unavailable')
  // JPEG has no transparency: without a ground, anything transparent in the
  // photo turns black and takes the handwriting over it with it.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) return reject(new Error('canvas produced no JPEG'))
        resolve(new File([blob], 'document.jpg', { lastModified, type: 'image/jpeg' }))
      },
      'image/jpeg',
      SHEET_JPEG_QUALITY,
    )
  })
}
