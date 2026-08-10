import { Badge, Button } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { NativeSelect } from '../../../components/Page'
import { showToast } from '../../../lib/toast'
import {
  membershipPath,
  membershipPlansPath,
  type CustomerMembership,
  type MembershipPlan,
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
 */
export function MembershipBadge({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['ledger'])
  const [membership, setMembership] = useState<CustomerMembership | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [granting, setGranting] = useState(false)
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null)

  useEffect(() => {
    let current = true
    setMembership(null)
    setFailed(false)
    setGranting(false)
    setLoading(true)
    void (async () => {
      try {
        const found = await courseboardApiJson<CustomerMembership>(membershipPath(customerId))
        if (!current) return
        setMembership(found)
      } catch {
        // Not a blocker: the booking is writable whether or not the standing
        // could be read, so this stays a quiet "unknown" rather than a toast.
        if (current) setFailed(true)
      } finally {
        if (current) setLoading(false)
      }
    })()
    return () => {
      current = false
    }
  }, [customerId])

  const openGrant = async () => {
    setGranting(true)
    if (plans) return
    try {
      // Active plans only. A plan the course retired is not something to put a
      // new member on, even though the members already on it stay members.
      const found = await courseboardApiJson<MembershipPlanList>(membershipPlansPath)
      setPlans(found.items ?? [])
    } catch {
      setPlans([])
    }
  }

  const grant = async (planId: string) => {
    if (!planId) return
    try {
      const updated = await courseboardApiJson<CustomerMembership>(membershipPath(customerId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planId }),
      })
      setMembership(updated)
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

  if (loading) return <span className="ledger-membership__loading">{t('ledger:customer.membershipLoading')}</span>
  if (failed) return <span className="ledger-membership__loading">{t('ledger:customer.membershipUnknown')}</span>
  if (!membership) return null

  return (
    <span className="ledger-membership">
      {membership.isMember ? (
        <Badge variant="accent">{membership.plan?.name ?? t('ledger:customer.member')}</Badge>
      ) : (
        <Badge variant="neutral">{t('ledger:customer.visitor')}</Badge>
      )}

      {granting ? (
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
    </span>
  )
}
