import { describe, expect, it } from 'vitest'

import { arrangeCourses, canMove, moveCourse } from './courseOrder'

const courses = [
  { id: 'moiwa-in', name: '藻岩IN' },
  { id: 'karanuma-in', name: '空沼IN' },
  { id: 'moiwa-out', name: '藻岩OUT' },
]

describe('arrangeCourses', () => {
  it('follows the order the club arranged rather than the alphabet', () => {
    // 空沼IN, 藻岩OUT, 藻岩IN is the order groups go out, and no alphabet
    // produces it.
    const arranged = arrangeCourses(['karanuma-in', 'moiwa-out', 'moiwa-in'], courses)
    expect(arranged.map(course => course.name)).toEqual(['空沼IN', '藻岩OUT', '藻岩IN'])
  })

  it('puts a course nobody placed at the end instead of losing it', () => {
    const arranged = arrangeCourses(['moiwa-out'], courses)
    expect(arranged.map(course => course.id)).toEqual(['moiwa-out', 'karanuma-in', 'moiwa-in'])
  })

  it('falls back to name order when nothing is arranged', () => {
    expect(arrangeCourses([], courses).map(course => course.name)).toEqual([
      '空沼IN',
      '藻岩IN',
      '藻岩OUT',
    ])
  })

  it('ignores an id that no longer names a course', () => {
    const arranged = arrangeCourses(['gone', 'moiwa-in'], courses)
    expect(arranged[0]!.id).toBe('moiwa-in')
  })

  it('does not disturb the list it was given', () => {
    const input = [...courses]
    arrangeCourses(['moiwa-out'], input)
    expect(input[0]!.id).toBe('moiwa-in')
  })
})

describe('moveCourse', () => {
  const order = ['a', 'b', 'c']
  const allVisible = ['a', 'b', 'c']

  it('swaps a column with the one beside it', () => {
    expect(moveCourse(order, allVisible, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveCourse(order, allVisible, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('does nothing at either end', () => {
    expect(moveCourse(order, allVisible, 'a', -1)).toEqual(order)
    expect(moveCourse(order, allVisible, 'c', 1)).toEqual(order)
  })

  it('moves past the column on screen, not past a hidden one', () => {
    // With `b` filtered out, `a` and `c` sit side by side; the arrow has to move
    // `c` past `a` or the click looks like it did nothing.
    expect(moveCourse(order, ['a', 'c'], 'c', -1)).toEqual(['c', 'b', 'a'])
  })

  it('leaves a hidden course exactly where it was', () => {
    // Filtering the board must never quietly rearrange it for everyone else.
    const next = moveCourse(['a', 'hidden', 'c'], ['a', 'c'], 'c', -1)
    expect(next[1]).toBe('hidden')
    expect(next).toEqual(['c', 'hidden', 'a'])
  })

  it('does nothing when the column is not on screen at all', () => {
    expect(moveCourse(order, ['a', 'c'], 'b', -1)).toEqual(order)
  })

  it('does nothing for a course that is not in the arrangement', () => {
    expect(moveCourse(order, allVisible, 'gone', 1)).toEqual(order)
  })

  it('does not disturb the arrangement it was given', () => {
    const input = ['a', 'b', 'c']
    moveCourse(input, allVisible, 'b', 1)
    expect(input).toEqual(['a', 'b', 'c'])
  })
})

describe('canMove', () => {
  it('is false at the ends of what is on screen', () => {
    expect(canMove(['a', 'b'], 'a', -1)).toBe(false)
    expect(canMove(['a', 'b'], 'b', 1)).toBe(false)
  })

  it('is true in the middle', () => {
    expect(canMove(['a', 'b'], 'a', 1)).toBe(true)
    expect(canMove(['a', 'b'], 'b', -1)).toBe(true)
  })

  it('is false for a single column, which has nowhere to go', () => {
    expect(canMove(['a'], 'a', -1)).toBe(false)
    expect(canMove(['a'], 'a', 1)).toBe(false)
  })

  it('is false for a column that is not on screen', () => {
    expect(canMove(['a', 'b'], 'c', 1)).toBe(false)
  })
})
