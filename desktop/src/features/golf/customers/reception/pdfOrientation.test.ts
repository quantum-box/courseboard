// @vitest-environment jsdom
import { PDFDocument, degrees } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ detect: vi.fn(), terminate: vi.fn(), destroy: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 4, getPage: async () => ({
      getViewport: () => ({ width: 100, height: 200 }),
      render: () => ({ promise: Promise.resolve() }), cleanup: vi.fn(),
    }) }), destroy: mocks.destroy,
  }),
}))
vi.mock('tesseract.js', () => ({ createWorker: async () => ({ detect: mocks.detect, terminate: mocks.terminate }) }))
import { confidentPageRotation, pageRotations, orientPdf } from './pdfOrientation'

beforeEach(() => vi.clearAllMocks())
describe('PDF text orientation', () => {
  it('does not rotate ambiguous, empty, or already upright pages', () => {
    expect(confidentPageRotation(90, 14.9)).toBe(0)
    expect(confidentPageRotation(null, null)).toBe(0)
    expect(confidentPageRotation(0, 20)).toBe(0)
    expect(confidentPageRotation(180, 20)).toBe(180)
  })
  it('uses consistent strong pages only for matching medium-confidence pages', () => {
    const detection = (angle: number, confidence: number) => ({ orientation_degrees: angle, orientation_confidence: confidence })
    expect(pageRotations([detection(270, 20), detection(270, 18), detection(270, 12), detection(90, 12), detection(270, 3)]))
      .toEqual([270, 270, 270, 0, 0])
    expect(pageRotations([detection(270, 20), detection(90, 18), detection(270, 12)]))
      .toEqual([270, 90, 0])
  })
  it('corrects each page relative to its authored rotation and reports progress', async () => {
    const original = await PDFDocument.create()
    for (const rotation of [270, 0, 90, 0]) original.addPage([100, 200]).setRotation(degrees(rotation))
    const file = new File([new Blob([await original.save()])], 'scan.pdf', { type: 'application/pdf' })
    for (const [angle, confidence] of [[270, 20], [180, 20], [90, 20], [90, 3]]) {
      mocks.detect.mockResolvedValueOnce({ data: { orientation_degrees: angle, orientation_confidence: confidence } })
    }
    const progress = vi.fn()
    const result = await orientPdf(file, progress)
    const corrected = await PDFDocument.load(await result.arrayBuffer())
    expect(corrected.getPages().map(page => page.getRotation().angle)).toEqual([180, 180, 180, 0])
    expect(corrected.getPageCount()).toBe(4)
    expect(progress.mock.calls.map(([value]) => value.completed)).toEqual([0, 1, 2, 3, 4])
    expect(mocks.terminate).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })
})
