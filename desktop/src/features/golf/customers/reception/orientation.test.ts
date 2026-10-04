import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { autoOrientReceptionSheet, rotateReceptionSheet } from './orientation'

async function scannedPdf(rotation: number) {
  const document = await PDFDocument.create()
  document.addPage([362.64, 515.76]).setRotation(degrees(rotation))
  const bytes = await document.save()
  return new File([new Blob([bytes], { type: 'application/pdf' })], 'scan.pdf', {
    type: 'application/pdf',
  })
}

describe('PDF reception orientation', () => {
  it.each([0, 90, 180, 270])('preserves authored rotation %i without guessing text direction', async rotation => {
    const original = await scannedPdf(rotation)
    const prepared = await autoOrientReceptionSheet(original)
    expect(prepared).toBe(original)
    const document = await PDFDocument.load(await prepared.arrayBuffer())
    expect(document.getPage(0).getRotation().angle).toBe(rotation)
  })

  it('lets the operator turn a clockwise sideways scan left without automatic compensation', async () => {
    const original = await scannedPdf(270)
    const upright = await rotateReceptionSheet(await autoOrientReceptionSheet(original), 270)
    const document = await PDFDocument.load(await upright.arrayBuffer())
    expect(document.getPage(0).getRotation().angle).toBe(180)
    expect(await autoOrientReceptionSheet(upright)).toBe(upright)
  })
})
