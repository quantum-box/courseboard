import { courseboardApiJson } from '../../../api'
import type {
  ReservationReportCourseMapping,
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
) {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('year', String(year))
  if (mappings) form.append('courseMappings', JSON.stringify(mappings))
  if (normalizedFingerprint) form.append('normalizedFingerprint', normalizedFingerprint)
  return form
}

export function previewReservationReport(file: File, year: number) {
  return courseboardApiJson<ReservationReportPreview>(PREVIEW_PATH, {
    method: 'POST',
    body: reportForm(file, year),
  })
}

export function importReservationReport(
  file: File,
  year: number,
  mappings: Record<string, string>,
  normalizedFingerprint: string,
) {
  return courseboardApiJson<ReservationReportImportResult>(IMPORT_PATH, {
    method: 'POST',
    body: reportForm(file, year, mappings, normalizedFingerprint),
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
