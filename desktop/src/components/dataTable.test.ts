import { describe, expect, it } from 'vitest'
import {
  compareSortValues,
  filterRows,
  nextSort,
  pageCountOf,
  pageSlice,
  serverPageAfterEmpty,
  serverPager,
  sortRows,
  type SortableColumn,
} from './dataTable'

type Row = { name: string; staffId: string | null; pay: number | null }

const rows: Row[] = [
  { name: '佐藤 彩', staffId: 'staff_aya', pay: 144000 },
  { name: '渡辺 健', staffId: 'staff_ken', pay: 88000 },
  { name: '田中 美香', staffId: null, pay: null },
]

const columns: SortableColumn<Row>[] = [
  {
    key: 'name',
    sortValue: row => row.name,
    searchValue: row => `${row.name} ${row.staffId ?? ''}`,
  },
  { key: 'pay', sortValue: row => row.pay },
]

describe('search', () => {
  it('keeps every row for a blank query', () => {
    expect(filterRows(rows, columns, '   ')).toHaveLength(3)
  })

  it('matches a column that is not rendered as the row label', () => {
    // The staff id is what payroll cross-references; nobody reads it at a glance.
    expect(filterRows(rows, columns, 'staff_ken').map(row => row.name)).toEqual(['渡辺 健'])
  })

  it('ignores width and case, the way a pasted HRM export arrives', () => {
    expect(filterRows(rows, columns, 'STAFF_AYA')).toHaveLength(1)
    expect(filterRows(rows, columns, 'ｓｔａｆｆ＿ａｙａ')).toHaveLength(1)
  })

  it('keeps every row when no column offers anything to search', () => {
    const unsearchable: SortableColumn<Row>[] = [{ key: 'pay', sortValue: row => row.pay }]
    expect(filterRows(rows, unsearchable, 'staff_aya')).toHaveLength(3)
  })
})

describe('sort', () => {
  it('leaves the order alone for a column that declares no sort value', () => {
    const plain: SortableColumn<Row> = { key: 'plain' }
    expect(sortRows(rows, plain, 'asc')).toBe(rows)
  })

  it('does not reorder the array it was handed', () => {
    const original = [...rows]
    sortRows(rows, columns[1], 'desc')
    expect(rows).toEqual(original)
  })

  it('puts a missing value last in both directions', () => {
    // Descending by amount, a null at the top would read as the largest payout.
    expect(sortRows(rows, columns[1], 'asc').at(-1)?.name).toBe('田中 美香')
    expect(sortRows(rows, columns[1], 'desc').at(-1)?.name).toBe('田中 美香')
  })

  it('orders amounts numerically rather than as text', () => {
    const amounts: Row[] = [
      { name: 'a', staffId: null, pay: 9 },
      { name: 'b', staffId: null, pay: 100 },
    ]
    expect(sortRows(amounts, columns[1], 'asc').map(row => row.pay)).toEqual([9, 100])
  })

  it('compares two absent values as equal', () => {
    expect(compareSortValues(null, null)).toBe(0)
  })
})

describe('header clicks', () => {
  it('starts a new column ascending and flips the one already sorted', () => {
    expect(nextSort(null, 'pay')).toEqual({ key: 'pay', direction: 'asc' })
    expect(nextSort({ key: 'pay', direction: 'asc' }, 'pay'))
      .toEqual({ key: 'pay', direction: 'desc' })
    expect(nextSort({ key: 'pay', direction: 'desc' }, 'name'))
      .toEqual({ key: 'name', direction: 'asc' })
  })
})

describe('pages', () => {
  const many = Array.from({ length: 25 }, (_, index) => index)

  it('counts a partial last page', () => {
    expect(pageCountOf(25, 10)).toBe(3)
  })

  it('gives an empty set one page rather than none', () => {
    expect(pageCountOf(0, 10)).toBe(1)
  })

  it('returns the slice for the page asked for', () => {
    expect(pageSlice(many, 1, 10).rows).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it('falls back to the last page when the one asked for no longer exists', () => {
    // Filtering down while on page 3 must not leave the table blank.
    expect(pageSlice(many.slice(0, 12), 2, 10)).toEqual({ page: 1, rows: [10, 11] })
  })
})

describe('server paging', () => {
  it('counts the rows on the page from where the page starts in the whole list', () => {
    expect(serverPager({ page: 2, pageSize: 20, rowCount: 5, total: 45 })).toEqual({
      from: 41,
      to: 45,
      pageCount: 3,
      canPrev: true,
      canNext: false,
    })
  })

  it('steps forward on hasMore when upstream cannot say how many there are', () => {
    const pager = serverPager({ page: 0, pageSize: 20, rowCount: 20, hasMore: true })
    expect(pager.pageCount).toBeNull()
    expect(pager.canNext).toBe(true)
    expect(serverPager({ page: 1, pageSize: 20, rowCount: 3, hasMore: false }).canNext).toBe(false)
  })

  it('moves back to the last real page when the one on screen was emptied', () => {
    // Settling the last two rows of page three leaves forty.
    expect(serverPageAfterEmpty(2, 20, 40)).toBe(1)
    expect(serverPageAfterEmpty(1, 20, undefined)).toBe(0)
    // An empty first page is an empty list, not a page to leave.
    expect(serverPageAfterEmpty(0, 20, 0)).toBeNull()
  })
})
