/* @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
import { syncReceptionScroll } from './scrollSync'
it('uses provenance rather than row order when earlier pages have several people', () => {
  const rows = document.createElement('ol')
  const preview = document.createElement('div')
  rows.innerHTML = '<li data-source-index="0" data-source-page="25"></li>'
  preview.innerHTML = '<div data-source-index="0" data-source-page="1"></div><div data-source-index="0" data-source-page="25"></div>'
  vi.spyOn(rows, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
  vi.spyOn(rows.children[0], 'getBoundingClientRect').mockReturnValue({ bottom: 200 } as DOMRect)
  vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
  vi.spyOn(preview.children[1], 'getBoundingClientRect').mockReturnValue({ top: 800 } as DOMRect)
  expect(syncReceptionScroll(rows, preview)).toBe(true)
  expect(preview.scrollTop).toBe(700)
})
it('does not guess a page for legacy results without provenance', () => {
  const rows = document.createElement('ol')
  const preview = document.createElement('div')
  expect(syncReceptionScroll(rows, preview)).toBe(false)
  expect(preview.scrollTop).toBe(0)
})
