import { courseboardApiJson } from '../../../api'
import type {
  ReservationReportCourseMapping,
  ReservationReportColumnMappings,
  ReservationReportEntry,
  ReservationReportImportResult,
  ReservationReportPdfRotation,
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
  rotation?: ReservationReportPdfRotation,
) {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('year', String(year))
  if (mappings) {
    // Omit blank choices from the wire mapping. Their absence explicitly means
    // "store this source facility without a CourseBoard course link".
    const selectedMappings = Object.fromEntries(
      Object.entries(mappings)
        .map(([sourceCourseKey, golfCourseId]) => [sourceCourseKey, golfCourseId.trim()] as const)
        .filter(([, golfCourseId]) => golfCourseId.length > 0),
    )
    form.append('courseMappings', JSON.stringify(selectedMappings))
  }
  if (normalizedFingerprint) form.append('normalizedFingerprint', normalizedFingerprint)
  if (columnMappings) form.append('columnMappings', JSON.stringify(columnMappings))
  // Only sent when the page is actually turned. Field rejects multipart fields
  // it does not know, so a request that turns nothing must not name it.
  if (rotation) form.append('rotation', String(rotation))
  return form
}

export function previewReservationReport(
  file: File,
  year: number,
  columnMappings?: ReservationReportColumnMappings,
  rotation?: ReservationReportPdfRotation,
) {
  return courseboardApiJson<ReservationReportPreview>(PREVIEW_PATH, {
    method: 'POST',
    body: reportForm(file, year, undefined, undefined, columnMappings, rotation),
  })
}

export function importReservationReport(
  file: File,
  year: number,
  mappings: Record<string, string>,
  normalizedFingerprint: string,
  columnMappings?: ReservationReportColumnMappings,
  rotation?: ReservationReportPdfRotation,
) {
  return courseboardApiJson<ReservationReportImportResult>(IMPORT_PATH, {
    method: 'POST',
    body: reportForm(file, year, mappings, normalizedFingerprint, columnMappings, rotation),
  })
}

export function listReservationReportEntries(from: string, to: string) {
  const params = new URLSearchParams({ from, to })
  return courseboardApiJson<{ items: ReservationReportEntry[] }>(
    `${ENTRIES_PATH}?${params.toString()}`,
  )
}

export function mappingPayload(mappings: Record<string, string>): ReservationReportCourseMapping[] {
  return Object.entries(mappings)
    .filter(([, golfCourseId]) => golfCourseId.trim().length > 0)
    .map(([sourceCourseKey, golfCourseId]) => ({
      sourceCourseKey,
      golfCourseId: golfCourseId.trim(),
    }))
}
