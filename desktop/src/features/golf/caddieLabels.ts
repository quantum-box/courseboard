/**
 * Operator-facing wording for the raw codes the caddie API returns.
 *
 * Shared because the same codes are shown on the roster, the assignment board
 * and the name preview, and a caddie who reads as "休んでいる" in one place must
 * not read as `inactive` in another.
 */

import { i18next } from '../../i18n'
import { skillLabelKey } from './caddieRegistration'

export const EMPLOYMENT_STATUSES = ['active', 'inactive', 'suspended'] as const
export const ACTIVE_EMPLOYMENT = 'active'

export function skillLabel(skill: string) {
  const key = skillLabelKey(skill)
  if (!key) return skill
  return i18next.t(`caddies:skill.${key}` as 'caddies:skill.rookie')
}

/**
 * The API is not consistent about the case of its status codes and the server
 * compares them case-insensitively, so `"Active"` has to mean the same thing as
 * `"active"` here too — otherwise a caddie is wrongly blocked from clocking in
 * and the raw code leaks into the copy. Codes we do not know keep their
 * original spelling so nothing is silently rewritten.
 */
export function employmentStatusCode(status: string) {
  const folded = status.trim().toLowerCase()
  return (EMPLOYMENT_STATUSES as readonly string[]).includes(folded) ? folded : status.trim()
}

export function isEmploymentActive(status: string) {
  return employmentStatusCode(status) === ACTIVE_EMPLOYMENT
}

export function employmentLabel(status: string) {
  const code = employmentStatusCode(status)
  if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(code)) return status
  return i18next.t(`caddies:employment.${code}` as 'caddies:employment.active')
}
