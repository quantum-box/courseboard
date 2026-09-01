import { describe, expect, it } from 'vitest'

import {
  formatMembershipActivity,
  formatMembershipActivitySnapshot,
  formatMembershipActivitySource,
  formatMembershipActivityTarget,
  membershipActivitiesPath,
  membershipActivityKindLabel,
  type MembershipActivity,
} from './membership-activities'

const baseActivity = {
  after: null,
  actor: { id: 'operator_1', type: 'user' },
  before: null,
  id: 'mact_1',
  kind: 'membership.subject_updated',
  occurredAt: '2026-09-01T00:00:00Z',
  schemaVersion: 1,
  source: null,
  target: { id: 'subject_1', type: 'subject' },
} satisfies MembershipActivity

describe('membership activity formatter', () => {
  it('formats a known kind and allowlisted snapshot fields', () => {
    const presentation = formatMembershipActivity({
      ...baseActivity,
      after: {
        birthDate: '2020-01-02',
        name: 'ポチ',
        subjectType: 'dog',
      },
    })
    expect(presentation.kindLabel).toBe('対象を更新')
    expect(presentation.summary).toContain('ポチ')
    expect(presentation.summary).toContain('2020/01/02')
  })

  it('formats the contract fields without exposing arbitrary snapshot keys', () => {
    const summary = formatMembershipActivitySnapshot('membership.credential_updated', {
      archived: true,
      issuedOn: '2026-01-01',
      kind: 'vaccination',
      note: '窓口で確認',
      secret: 'not shown',
      subjectId: 'subject_1',
      verifiedBy: 'operator_1',
    })
    expect(summary).toContain('対象ID: subject_1')
    expect(summary).toContain('発行日: 2026/01/01')
    expect(summary).toContain('状態: アーカイブ済み')
    expect(summary).not.toContain('not shown')
  })

  it('formats consent terms and channel while preserving a type-only target', () => {
    const summary = formatMembershipActivitySnapshot('membership.consents_recorded', {
      consents: [{
        accepted: true,
        channel: 'web',
        consentKey: 'terms',
        termsVersion: '2026-01',
      }],
    })
    expect(summary).toContain('terms')
    expect(summary).toContain('規約: 2026-01')
    expect(summary).toContain('Web')
  })

  it('keeps unknown event kinds forward-compatible', () => {
    expect(membershipActivityKindLabel('membership.future_change')).toBe(
      '会員変更（membership.future_change）',
    )
    const presentation = formatMembershipActivity({
      ...baseActivity,
      kind: 'membership.future_change',
      after: { secret: 'must not be shown by default' },
    })
    expect(presentation.kindLabel).toContain('membership.future_change')
    expect(presentation.summary).toBe('変更内容を表示できません。')
    expect(
      formatMembershipActivitySnapshot('membership.future_change', {
        secret: 'must not be shown by default',
      }),
    ).toBe('')
  })

  it('does not show a null source application', () => {
    expect(formatMembershipActivitySource({ application: null, channel: null })).toBeNull()
    expect(formatMembershipActivitySource({ application: null, channel: 'store' })).toBe(
      '経路: 店頭',
    )
    expect(
      formatMembershipActivitySource({ application: 'desktop', channel: 'store' }),
    ).toBe('アプリ: desktop / 経路: 店頭')
  })

  it('keeps a target type when the provider has no target id', () => {
    expect(formatMembershipActivityTarget({ type: 'consent', id: null })).toBe('consent')
    expect(formatMembershipActivityTarget(null)).toBeNull()
  })

  it('encodes customer ids and opaque cursors in the proxy path', () => {
    expect(membershipActivitiesPath('cus/a', 5, 'eyJ0eXBlIjoi/')).toBe(
      '/v1/course/customers/cus%2Fa/membership-activities?limit=5&cursor=eyJ0eXBlIjoi%2F',
    )
    expect(membershipActivitiesPath('cus_1', 5, '  ')).toBe(
      '/v1/course/customers/cus_1/membership-activities?limit=5&cursor=++',
    )
  })
})
