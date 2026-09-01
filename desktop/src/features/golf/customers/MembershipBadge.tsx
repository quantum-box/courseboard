import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { NativeSelect } from '../../../components/Page'
import { useResource } from '../../../hooks/useResource'
import { showToast } from '../../../lib/toast'
import {
  memberNumberPath,
  membershipPath,
  membershipPlansPath,
  type CustomerMembership,
  type MembershipPlanList,
} from './membership'

/**
 * Whether the person the desk just picked is a member, and of what.
 *
 * This is the answer to the question the desk actually asks about a name —
 * before the round is priced, before the plan is chosen. Everyone in the ledger
 * gets an answer: a visitor reads as a visitor, not as a blank.
 *
 * `isMember` comes from the server rather than being inferred from whether a
 * plan came back. What counts as a member is a golf judgement, and two places
 * deciding it is how they come to disagree.
 *
 * Granting a membership is off by default. Taking a booking and admitting
 * somebody to the club are different jobs done at different moments, and a
 * control that changes what a person *is* does not belong in a form about one
 * afternoon's tee time. The customer's own page turns it on.
 */
export function MembershipBadge({
  customerId,
  editable = false,
}: {
  customerId: string
  editable?: boolean
}) {
  const { t } = useTranslation(['ledger'])
  const membershipResource = useResource(
    () => courseboardApiJson<CustomerMembership>(membershipPath(customerId)),
    [customerId],
    { cacheKey: `customer:membership:${customerId}` },
  )
  const membership = membershipResource.data
  const loading = membershipResource.loading
  const failed = membershipResource.error !== null
  const [granting, setGranting] = useState(false)
  const [numbering, setNumbering] = useState<string | null>(null)
  const [savingNumber, setSavingNumber] = useState(false)

  useEffect(() => {
    setGranting(false)
    setNumbering(null)
  }, [customerId])

  const plansResource = useResource(
    () => courseboardApiJson<MembershipPlanList>(membershipPlansPath),
    [],
    { cacheKey: 'membership:plans:active', enabled: granting },
  )
  const plans = plansResource.data?.items ?? null

  const openGrant = () => {
    setGranting(true)
  }

  const grant = async (planId: string) => {
    if (!planId) return
    try {
      const updated = await courseboardApiJson<CustomerMembership>(membershipPath(customerId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId }),
      })
      membershipResource.setData(updated)
      setGranting(false)
      showToast({ tone: 'success', message: t('ledger:customer.membershipGranted') })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:customer.membershipGrantFailed'),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const saveNumber = async () => {
    if (numbering === null) return
    setSavingNumber(true)
    try {
      const updated = await courseboardApiJson<CustomerMembership>(memberNumberPath(customerId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        // Blank withdraws the number rather than storing an empty one.
        body: JSON.stringify({ memberNumber: numbering.trim() || null }),
      })
      membershipResource.setData(updated)
      setNumbering(null)
      showToast({ tone: 'success', message: t('ledger:customer.memberNumberSaved') })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:customer.memberNumberFailed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSavingNumber(false)
    }
  }

  if (loading && !membership) {
    return <span className="ledger-membership__loading">{t('ledger:customer.membershipLoading')}</span>
  }
  if (!membership) {
    if (failed) return <span className="ledger-membership__loading">{t('ledger:customer.membershipUnknown')}</span>
    return null
  }
  return (
    <span className="ledger-membership">
      {membership.isMember ? (
        <Badge variant="accent">{membership.plan?.name ?? t('ledger:customer.member')}</Badge>
      ) : (
        <Badge variant="neutral">{t('ledger:customer.visitor')}</Badge>
      )}

      {!editable ? null : granting ? (
        <NativeSelect
          defaultValue=""
          onChange={event => void grant(event.target.value)}
        >
          <option value="">{t('ledger:customer.choosePlan')}</option>
          {(plans ?? []).map(plan => (
            <option key={plan.id} value={plan.id}>{plan.name}</option>
          ))}
        </NativeSelect>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => void openGrant()}>
          {membership.isMember
            ? t('ledger:customer.changeMembership')
            : t('ledger:customer.grantMembership')}
        </Button>
      )}

      {/* Only on the customer's own page. A member number is a fact about a
          person, not about the afternoon's tee time, so the booking form never
          shows this control. */}
      {editable ? (
        numbering !== null ? (
          <>
            <Input
              value={numbering}
              autoFocus
              maxLength={40}
              placeholder={t('ledger:customer.memberNumberPlaceholder')}
              onChange={event => setNumbering(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={savingNumber}
              onClick={() => void saveNumber()}
            >
              {t('ledger:customer.memberNumberSave')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNumbering(null)}
            >
              {t('ledger:customer.memberNumberCancel')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNumbering(membership.memberNumber ?? '')}
          >
            {membership.memberNumber
              ? t('ledger:customer.memberNumberValue', { number: membership.memberNumber })
              : t('ledger:customer.memberNumberAdd')}
          </Button>
        )
      ) : null}
    </span>
  )
}
