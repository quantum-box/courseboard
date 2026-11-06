import type { PartyRemarks, PartySettlement } from './models'

/**
 * The remarks as the sheet edits them: every control is a string, so an unset
 * select and an empty input both read as `''` rather than `undefined`.
 */
export type RemarksDraft = {
  meal: string
  scoreTally: '' | 'yes' | 'no'
  settlement: '' | PartySettlement
}

export const emptyRemarksDraft: RemarksDraft = { meal: '', scoreTally: '', settlement: '' }

export function toRemarksDraft(remarks?: PartyRemarks | null): RemarksDraft {
  return {
    meal: remarks?.meal ?? '',
    scoreTally: remarks?.scoreTally === true ? 'yes' : remarks?.scoreTally === false ? 'no' : '',
    settlement: remarks?.settlement === 'individual' || remarks?.settlement === 'together'
      ? remarks.settlement
      : '',
  }
}

/** What the API takes. Unset fields are left out, which clears them. */
export function toRemarks(draft: RemarksDraft): PartyRemarks {
  return {
    ...(draft.meal.trim() ? { meal: draft.meal.trim() } : {}),
    ...(draft.scoreTally ? { scoreTally: draft.scoreTally === 'yes' } : {}),
    ...(draft.settlement ? { settlement: draft.settlement } : {}),
  }
}

export function isRemarksDraftEmpty(draft: RemarksDraft): boolean {
  return !draft.meal.trim() && !draft.scoreTally && !draft.settlement
}
