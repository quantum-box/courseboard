/**
 * Searching, sorting, and paging a `DataTable`.
 *
 * Split out of the component so the rules can be checked without a DOM: which
 * rows a query keeps, where an empty value sorts, and what the last page holds
 * are decisions, not rendering.
 */

export type DataTableSortDirection = 'asc' | 'desc'

export type DataTableSort = { key: string; direction: DataTableSortDirection }

/** The parts of a column this module needs; the component adds the rest. */
export type SortableColumn<T> = {
  key: string
  sortValue?: (row: T) => string | number | null
  searchValue?: (row: T) => string
}

/**
 * Fold width and case, so `ｱﾔ` finds 彩's row and `STAFF` finds `staff_aya`.
 *
 * Half-width katakana and full-width latin are both what an operator gets from
 * a barcode scanner or a paste out of the HRM export, and neither should miss.
 */
export function foldForSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja')
}

/**
 * Order two sort values, ascending.
 *
 * `null` always sorts last, in both directions: it means "no value recorded",
 * and putting it at the top of a descending amount column would read as the
 * largest one.
 */
export function compareSortValues(left: string | number | null, right: string | number | null) {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'ja')
}

/** Rows whose searchable columns contain `query`. Blank keeps everything. */
export function filterRows<T>(rows: T[], columns: SortableColumn<T>[], query: string) {
  const needle = foldForSearch(query.trim())
  if (needle === '') return rows
  const searchable = columns.filter(column => column.searchValue)
  if (searchable.length === 0) return rows
  return rows.filter(row => searchable.some(
    column => foldForSearch(column.searchValue?.(row) ?? '').includes(needle),
  ))
}

/**
 * Rows in the order the sort asks for, as a new array — sorting the caller's
 * array in place would reorder whatever else renders from it.
 */
export function sortRows<T>(
  rows: T[],
  column: SortableColumn<T> | undefined,
  direction: DataTableSortDirection,
) {
  if (!column?.sortValue) return rows
  const read = column.sortValue
  const flip = direction === 'desc' ? -1 : 1
  return [...rows].sort((left, right) => {
    const a = read(left)
    const b = read(right)
    // Absent values are placed outside the flip: negating the whole comparison
    // would drag the blanks to the top of a descending amount column, where
    // they read as the largest payout.
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    return compareSortValues(a, b) * flip
  })
}

export function pageCountOf(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * The rows on `page`, clamped into range.
 *
 * A filter or a reload can leave the viewer on a page that no longer exists;
 * showing the last one beats showing nothing.
 */
export function pageSlice<T>(rows: T[], page: number, pageSize: number) {
  const clamped = Math.min(Math.max(page, 0), pageCountOf(rows.length, pageSize) - 1)
  return { page: clamped, rows: rows.slice(clamped * pageSize, clamped * pageSize + pageSize) }
}

/** The sort a header click produces: same column flips, a new column starts ascending. */
export function nextSort(current: DataTableSort | null, key: string): DataTableSort {
  return current?.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' }
}

/**
 * What a table paged by the server shows in its pager.
 *
 * `total` is absent when the upstream list only says whether another page
 * exists: the pager can still step forward, it just cannot say how far there
 * is to go.
 */
export function serverPager({
  page,
  pageSize,
  rowCount,
  total,
  hasMore,
}: {
  page: number
  pageSize: number
  rowCount: number
  total?: number
  hasMore?: boolean
}) {
  const from = rowCount === 0 ? 0 : page * pageSize + 1
  const to = page * pageSize + rowCount
  const pageCount = total === undefined ? null : pageCountOf(total, pageSize)
  return {
    from,
    to,
    pageCount,
    canPrev: page > 0,
    canNext: pageCount === null ? Boolean(hasMore) : page < pageCount - 1,
  }
}

/**
 * The page to move to when the one on screen came back empty.
 *
 * Settling the last rows of the last page leaves the viewer on a page that no
 * longer exists. With a total the last real page is known; without one, one
 * step back is the best guess. `null` means stay: the page is fine, or it is
 * the first one and the list is simply empty.
 */
export function serverPageAfterEmpty(page: number, pageSize: number, total?: number) {
  if (page === 0) return null
  if (total === undefined) return page - 1
  const last = pageCountOf(total, pageSize) - 1
  return page > last ? last : null
}
