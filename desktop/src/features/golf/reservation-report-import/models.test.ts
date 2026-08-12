import { describe, expect, it } from 'vitest'
import {
  MAX_FILE_BYTES,
  columnMappingsFromAnalysis,
  fileValidationError,
  monthGridRows,
  monthsInRows,
  suggestCourseMappings,
  sumRows,
  validateCourseMappings,
  validateColumnMappings,
  type ReservationReportAnalysis,
  type ReservationReportRow,
} from './models'

const rows: ReservationReportRow[] = [
  {
    sourceCourseKey: 'makomanai',
    sourceCourseName: '真駒内',
    date: '2026-07-18',
    dayPart: 'morning',
    groupCount: 8,
    caddieAttachedGroupCount: 3,
  },
  {
    sourceCourseKey: 'makomanai',
    sourceCourseName: '真駒内',
    date: '2026-07-18',
    dayPart: 'afternoon',
    groupCount: 5,
    caddieAttachedGroupCount: 2,
  },
  {
    sourceCourseKey: 'takino',
    sourceCourseName: '滝の',
    date: '2026-08-01',
    dayPart: 'morning',
    groupCount: 2,
    caddieAttachedGroupCount: 1,
  },
]

describe('reservation report pure helpers', () => {
  it('rejects missing, oversized, and unsupported files', () => {
    expect(fileValidationError(null)).toBe('required')
    expect(fileValidationError(new File(['x'], 'report.docx'))).toBe('extension')
    expect(fileValidationError(new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'report.xlsx'))).toBe('size')
    expect(fileValidationError(new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'report.pdf'))).toBe('size')
    expect(fileValidationError(new File(['x'], 'report.csv'))).toBeNull()
    expect(fileValidationError(new File(['x'], 'report.xls'))).toBeNull()
    expect(fileValidationError(new File(['x'], 'report.pdf'))).toBeNull()
    expect(fileValidationError(new File(['x'], 'report.XLSX'))).toBeNull()
  })

  it('suggests only an unambiguous active course', () => {
    expect(suggestCourseMappings(
      [
        { sourceCourseKey: '真駒内', sourceCourseName: '真駒内\n36H' },
        { sourceCourseKey: 'unknown', sourceCourseName: '全体' },
      ],
      [
        { id: 'course-makomanai', name: '真駒内コース', shortName: '真駒内' },
        { id: 'course-west', name: '西コース', shortName: '西' },
      ],
    )).toEqual({ '真駒内': 'course-makomanai' })
  })

  it('rejects missing and duplicated mapping choices', () => {
    const facilities = [
      { sourceCourseKey: 'east', sourceCourseName: '東' },
      { sourceCourseKey: 'west', sourceCourseName: '西' },
    ]
    expect(validateCourseMappings(facilities, {})).toMatchObject({ valid: false, reason: 'missing' })
    expect(validateCourseMappings(facilities, { east: 'course-1', west: 'course-1' })).toEqual({
      valid: false,
      reason: 'duplicate',
    })
    expect(validateCourseMappings(facilities, { east: 'course-1', west: 'course-2' })).toEqual({ valid: true })
  })

  it('requires one distinct source column for every CourseBoard field', () => {
    const headers = ['施設', '日付', '時間帯', '組数', 'キャ付']
    const mappings = {
      facilityName: '施設',
      date: '日付',
      dayPart: '時間帯',
      groupCount: '組数',
      caddieAttachedGroupCount: 'キャ付',
    }
    expect(validateColumnMappings(headers, mappings)).toEqual({ valid: true })
    expect(validateColumnMappings(headers, { ...mappings, date: '' })).toMatchObject({
      valid: false,
      reason: 'missing',
    })
    expect(validateColumnMappings(headers, { ...mappings, date: '施設' })).toMatchObject({
      valid: false,
      reason: 'duplicate',
    })
    expect(validateColumnMappings(headers, { ...mappings, date: '受付日' })).toMatchObject({
      valid: false,
      reason: 'unknown',
    })
    expect(validateColumnMappings([...headers, '日付'], mappings)).toMatchObject({
      valid: false,
      reason: 'unknown',
    })
  })

  it('initializes editable column mappings from the provider candidates', () => {
    const analysis = {
      sourceType: 'csv',
      sheetNames: [],
      headers: ['施設', '日付'],
      mapping: {
        mode: 'ai',
        fields: [
          { source: '施設', target: 'facilityName', required: true, confidence: 0.9, explanation: 'AI', samples: [] },
          { source: '日付', target: 'date', required: true, confidence: 0.8, explanation: 'AI', samples: [] },
        ],
      },
      warnings: [],
    } satisfies ReservationReportAnalysis
    expect(columnMappingsFromAnalysis(analysis)).toEqual({
      facilityName: '施設',
      date: '日付',
    })
  })

  it('groups morning and afternoon rows into a monthly table', () => {
    expect(monthGridRows(rows, '2026-07')).toEqual([{
      key: 'makomanai:2026-07-18',
      date: '2026-07-18',
      sourceCourseKey: 'makomanai',
      sourceCourseName: '真駒内',
      morningGroupCount: 8,
      morningCaddieAttachedGroupCount: 3,
      afternoonGroupCount: 5,
      afternoonCaddieAttachedGroupCount: 2,
    }])
    expect(monthsInRows(rows)).toEqual(['2026-07', '2026-08'])
  })

  it('sums rows without counting the overall total as a facility', () => {
    expect(sumRows(rows)).toEqual({
      facilityCount: 2,
      rowCount: 3,
      groupCount: 15,
      caddieAttachedGroupCount: 6,
    })
  })
})
