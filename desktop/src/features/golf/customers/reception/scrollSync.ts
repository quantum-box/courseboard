/** Find the source page at the top of one pane and align its counterpart. */
export function syncReceptionScroll(origin: HTMLElement, target: HTMLElement): boolean {
  const top = origin.getBoundingClientRect().top
  const current = Array.from(origin.querySelectorAll<HTMLElement>('[data-source-page]'))
    .find(entry => entry.getBoundingClientRect().bottom > top + 20)
  if (!current) return false
  const source = Number(current.dataset.sourceIndex)
  const page = Number(current.dataset.sourcePage)
  if (!Number.isInteger(source) || source < 0 || !Number.isInteger(page) || page < 1) return false
  const match = target.querySelector<HTMLElement>(`[data-source-index="${source}"][data-source-page="${page}"]`)
  if (!match) return false
  target.scrollTop += match.getBoundingClientRect().top - target.getBoundingClientRect().top
  return true
}
