import { courseboardApiJson } from '../../../../api'
import { customersPath, type Customer } from '../models'
import {
  customerPayload,
  uploadFileName,
  type ReceptionDraft,
  type ReceptionRow,
} from './models'

const RECEPTION_DRAFT_PATH = '/v1/course/customers/reception-draft'

/**
 * Reads one sheet. Nothing is stored anywhere along the way — not the file, not
 * the text upstream made of it — so a re-read means picking the file again.
 */
export function draftReceptionSheet(file: File) {
  const form = new FormData()
  form.append('file', file, uploadFileName(file))
  return courseboardApiJson<ReceptionDraft>(RECEPTION_DRAFT_PATH, {
    method: 'POST',
    body: form,
  })
}

/** Registers one approved row, through the same endpoint the ledger's form uses. */
export function registerReceptionRow(row: ReceptionRow) {
  return courseboardApiJson<Customer>(customersPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(customerPayload(row)),
  })
}
