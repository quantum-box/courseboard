import { describe, expect, it } from 'vitest'

import { isRemarksDraftEmpty, toRemarks, toRemarksDraft } from './partyRemarks'

describe('party remarks drafts', () => {
  it('round-trips what the API sent', () => {
    const remarks = {
      meal: '各自注文',
      scoreTally: false,
      settlement: 'together' as const,
      note: '早めに到着',
    }
    expect(toRemarks(toRemarksDraft(remarks))).toEqual(remarks)
  })

  it('leaves unset fields out so saving clears them', () => {
    expect(toRemarks({ meal: '  ', scoreTally: '', settlement: '', note: ' \n ' })).toEqual({})
    expect(isRemarksDraftEmpty(toRemarksDraft(null))).toBe(true)
  })

  it('treats a settlement word from a newer server as unset rather than showing it', () => {
    expect(toRemarksDraft({ settlement: 'card' }).settlement).toBe('')
  })
})
