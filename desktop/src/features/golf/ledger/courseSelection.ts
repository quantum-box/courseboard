/**
 * Which courses get a column on the ledger.
 *
 * An empty selection means every course. That is not the same as "none": a
 * board with no columns is useless, and a desk that has never touched the
 * picker expects to see the whole club.
 */

const STORAGE_KEY = 'courseboard.ledger.courses'

export type CourseOption = { id: string; name: string }

export function readStoredCourseIds(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return []
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((value): value is string => typeof value === 'string')
    } catch {
        // A corrupt or unavailable store falls back to showing everything
        // rather than to an empty board.
        return []
    }
}

export function writeStoredCourseIds(ids: string[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    } catch {
        // ignore storage failures
    }
}

/**
 * Add or remove one course.
 *
 * Unselecting the last one goes back to showing every course, because an empty
 * board answers nothing — the picker has no "none" state to land on.
 */
export function toggleCourse(selected: string[], courseId: string): string[] {
    return selected.includes(courseId)
        ? selected.filter(id => id !== courseId)
        : [...selected, courseId]
}

/**
 * The stored selection, with courses that no longer exist dropped.
 *
 * A course that was retired or moved to another tenant would otherwise keep
 * narrowing the board to columns nobody can see — and if it were the only
 * stored id, to no columns at all.
 */
export function resolveSelection(selected: string[], available: CourseOption[]): string[] {
    const ids = new Set(available.map(course => course.id))
    return selected.filter(id => ids.has(id))
}

/**
 * How many stand-in columns the board draws while the day is being fetched.
 *
 * The picked courses when there are any, otherwise the club's — the course list
 * is a much lighter call than the board and normally lands first, so the
 * stand-in already has the right shape. Two is the guess for the first paint,
 * when neither has arrived; the ceiling keeps a large club from drawing a
 * screenful of placeholders it would scroll past anyway.
 */
export function pendingColumnCount(selected: string[], available: CourseOption[]): number {
    const wanted = selected.length > 0 ? selected.length : available.length
    return Math.min(wanted || 2, 6)
}

/** Whether this course is drawn, given that empty means all. */
export function isCourseShown(selected: string[], courseId: string): boolean {
    return selected.length === 0 || selected.includes(courseId)
}

/** The `golfCourseIds` query value, or `null` when every course is wanted. */
export function courseIdsParam(selected: string[]): string | null {
    return selected.length === 0 ? null : selected.join(',')
}

/**
 * Selections compared as sets, so a re-render with the same courses in a
 * different order does not refetch the day.
 */
export function sameSelection(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false
    const rightSet = new Set(right)
    return left.every(id => rightSet.has(id))
}
