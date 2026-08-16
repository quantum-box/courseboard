import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  courseIdsParam,
  isCourseShown,
  pendingColumnCount,
  readStoredCourseIds,
  resolveSelection,
  sameSelection,
  toggleCourse,
  writeStoredCourseIds,
} from './courseSelection'

const courses = [
  { id: 'course-east', name: '東コース' },
  { id: 'course-west', name: '西コース' },
]

describe('toggleCourse', () => {
  it('adds a course that was not picked and removes one that was', () => {
    expect(toggleCourse([], 'course-east')).toEqual(['course-east'])
    expect(toggleCourse(['course-east'], 'course-east')).toEqual([])
  })

  it('keeps the order courses were picked in', () => {
    expect(toggleCourse(['course-west'], 'course-east')).toEqual(['course-west', 'course-east'])
  })
})

describe('isCourseShown', () => {
  it('shows every course when nothing is picked', () => {
    // Empty means all, not none: a board with no columns answers nothing.
    expect(isCourseShown([], 'course-east')).toBe(true)
    expect(isCourseShown([], 'anything')).toBe(true)
  })

  it('shows only the picked courses once there is a pick', () => {
    expect(isCourseShown(['course-east'], 'course-east')).toBe(true)
    expect(isCourseShown(['course-east'], 'course-west')).toBe(false)
  })
})

describe('resolveSelection', () => {
  it('drops a course that no longer exists', () => {
    // A retired course would otherwise keep narrowing the board to a column
    // nobody can see.
    expect(resolveSelection(['course-east', 'course-gone'], courses)).toEqual(['course-east'])
  })

  it('falls back to every course when the whole stored pick has gone', () => {
    expect(resolveSelection(['course-gone'], courses)).toEqual([])
  })

  it('leaves a pick that is entirely still there alone', () => {
    expect(resolveSelection(['course-west', 'course-east'], courses)).toEqual([
      'course-west',
      'course-east',
    ])
  })
})

describe('courseIdsParam', () => {
  it('asks for nothing in particular when every course is wanted', () => {
    expect(courseIdsParam([])).toBeNull()
  })

  it('sends the picked courses as one comma-separated value', () => {
    expect(courseIdsParam(['course-east', 'course-west'])).toBe('course-east,course-west')
  })
})

describe('pendingColumnCount', () => {
  it('stands in for the picked courses', () => {
    expect(pendingColumnCount(['course-east'], courses)).toBe(1)
  })

  it('stands in for the whole club when nothing is picked', () => {
    expect(pendingColumnCount([], courses)).toBe(2)
  })

  it('guesses two before either list has arrived', () => {
    // The first paint happens before the course list lands; a board of zero
    // columns would read as "this club has no courses".
    expect(pendingColumnCount([], [])).toBe(2)
  })

  it('stops at six so a large club does not draw a screenful of placeholders', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `course-${index}`,
      name: `コース${index}`,
    }))
    expect(pendingColumnCount([], many)).toBe(6)
  })
})

describe('sameSelection', () => {
  it('treats the same courses in a different order as unchanged', () => {
    // Otherwise a re-render that reorders the list refetches the whole day.
    expect(sameSelection(['a', 'b'], ['b', 'a'])).toBe(true)
  })

  it('sees a real change', () => {
    expect(sameSelection(['a'], ['a', 'b'])).toBe(false)
    expect(sameSelection(['a'], ['b'])).toBe(false)
  })
})

/** Tests run in the node environment, which has no `localStorage`. */
function memoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
  }
}

describe('stored selection', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads as every course when the browser refuses storage', () => {
    // Private-browsing and quota errors must not empty the board.
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
    })
    expect(readStoredCourseIds()).toEqual([])
    expect(() => writeStoredCourseIds(['course-east'])).not.toThrow()
  })

  it('survives a round trip', () => {
    writeStoredCourseIds(['course-east'])
    expect(readStoredCourseIds()).toEqual(['course-east'])
  })

  it('reads as every course when nothing was stored', () => {
    expect(readStoredCourseIds()).toEqual([])
  })

  it('reads as every course when the stored value is not a list of ids', () => {
    // A board with no columns is the worst possible answer to corrupt storage.
    localStorage.setItem('courseboard.ledger.courses', 'not json')
    expect(readStoredCourseIds()).toEqual([])
    localStorage.setItem('courseboard.ledger.courses', '{"a":1}')
    expect(readStoredCourseIds()).toEqual([])
    localStorage.setItem('courseboard.ledger.courses', '[1, "course-east", null]')
    expect(readStoredCourseIds()).toEqual(['course-east'])
  })
})
