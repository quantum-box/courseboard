/**
 * The left-to-right order courses sit in on the board.
 *
 * Mirrors the API's rule: courses the club placed come first in that order,
 * anything unplaced follows by name. Kept on this side too because moving a
 * column has to be computed against the whole arrangement, not just the columns
 * that happen to be on screen.
 */

import type { CourseOption } from './courseSelection'

/** Every course in board order, placed ones first. */
export function arrangeCourses(order: string[], courses: CourseOption[]): CourseOption[] {
  return [...courses].sort((left, right) => {
    const a = order.indexOf(left.id)
    const b = order.indexOf(right.id)
    if (a !== -1 && b !== -1) return a - b
    if (a !== -1) return -1
    if (b !== -1) return 1
    return left.name.localeCompare(right.name)
  })
}

/**
 * Move one column one place left or right.
 *
 * The swap happens between the course and its nearest *visible* neighbour, but
 * is written back into the full arrangement. Two things fall out of that, and
 * both matter:
 *
 * - With a filter on, the arrow moves the column past the column beside it on
 *   screen. Swapping in the full order instead would look like the click did
 *   nothing whenever a hidden course sat between the two.
 * - Courses the operator cannot see keep their exact places, so filtering the
 *   board never quietly rearranges it for everyone else.
 */
export function moveCourse(
  order: string[],
  visibleIds: string[],
  courseId: string,
  delta: -1 | 1,
): string[] {
  const visible = new Set(visibleIds)
  const slots = order.reduce<number[]>((indexes, id, index) => {
    if (visible.has(id)) indexes.push(index)
    return indexes
  }, [])
  const sequence = slots.map(index => order[index]!)

  const at = sequence.indexOf(courseId)
  const to = at + delta
  if (at === -1 || to < 0 || to >= sequence.length) return order

  const swapped = [...sequence]
  swapped[at] = sequence[to]!
  swapped[to] = sequence[at]!

  const next = [...order]
  slots.forEach((index, position) => {
    next[index] = swapped[position]!
  })
  return next
}

/** Whether the arrow at this end would do anything. */
export function canMove(visibleIds: string[], courseId: string, delta: -1 | 1): boolean {
  const at = visibleIds.indexOf(courseId)
  if (at === -1) return false
  const to = at + delta
  return to >= 0 && to < visibleIds.length
}
