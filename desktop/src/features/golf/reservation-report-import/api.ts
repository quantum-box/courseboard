import { courseboardApiJson } from '../../../api'
import type {
  ReservationReportCourseMapping,
  ReservationReportColumnMappings,
  ReservationReportEntry,
  ReservationReportImportResult,
  ReservationReportPreview,
} from './models'

const PREVIEW_PATH = '/v1/course/reservation-report-imports/preview'
const IMPORT_PATH = '/v1/course/reservation-report-imports'
const ENTRIES_PATH = '/v1/course/reservation-report-entries'

function reportForm(
  file: File,
  year: number,
  mappings?: Record<string, string>,
  normalizedFingerprint?: string,
  columnMappings?: ReservationReportColumnMappings,
) {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('year', String(year))
  if (mappings) form.append('courseMappings', JSON.stringify(mappings))
  if (normalizedFingerprint) form.append('normalizedFingerprint', normalizedFingerprint)
  if (columnMappings) form.append('columnMappings', JSON.stringify(columnMappings))
  return form
}

export function previewReservationReport(
  file: File,
  year: number,
  columnMappings?: ReservationReportColumnMappings,
) {
  return courseboardApiJson<ReservationReportPreview>(PREVIEW_PATH, {
    method: 'POST',
    body: reportForm(file, year, undefined, undefined, columnMappings),
  })
}

export function importReservationReport(
  file: File,
  year: number,
  mappings: Record<string, string>,
  normalizedFingerprint: string,
  columnMappings?: ReservationReportColumnMappings,
) {
  return courseboardApiJson<ReservationReportImportResult>(IMPORT_PATH, {
    method: 'POST',
    body: reportForm(file, year, mappings, normalizedFingerprint, columnMappings),
  })
}

export function listReservationReportEntries(from: string, to: string) {
  const params = new URLSearchParams({ from, to })
  return courseboardApiJson<{ items: ReservationReportEntry[] }>(
    `${ENTRIES_PATH}?${params.toString()}`,
  )
}

export function mappingPayload(mappings: Record<string, string>): ReservationReportCourseMapping[] {
  return Object.entries(mappings).map(([sourceCourseKey, golfCourseId]) => ({
    sourceCourseKey,
    golfCourseId,
  }))
}
