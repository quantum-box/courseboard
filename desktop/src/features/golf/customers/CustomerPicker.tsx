import { Button, Input } from '@tachyon-sdk/native-ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { showToast } from '../../../lib/toast'
import { MembershipBadge } from './MembershipBadge'
import { customerDistinguisher, type Customer } from './models'
import { rememberRegisteredCustomer } from './recentlyRegistered'
import { useCustomerSearch } from './useCustomerSearch'

/**
 * A name box that also says who that name is in the ledger.
 *
 * The desk types the name it was given; candidates appear underneath; picking
 * one records who played, and picking none is a normal outcome the booking
 * survives. That order matters — a picker that demanded an identity before it
 * accepted a name would stop the desk mid-call, and the booking would be
 * written somewhere else instead.
 */
export function CustomerPicker({
  name,
  customerId,
  placeholder,
  onNameChange,
  onSelect,
  disabled,
}: {
  name: string
  customerId: string | null
  placeholder?: string
  onNameChange: (name: string) => void
  /** `null` clears the identity while leaving the typed name alone. */
  onSelect: (customer: Customer | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation(['ledger'])
  const [registering, setRegistering] = useState(false)
  // Suppressed after a pick so the list does not reopen over the chosen name,
  // and again while the desk edits a name it has already linked.
  const [showCandidates, setShowCandidates] = useState(false)
  const { candidates, searching, completedQuery, error } = useCustomerSearch(
    showCandidates && !customerId ? name : '',
  )

  const trimmed = name.trim()

  const register = async () => {
    if (!trimmed) return
    setRegistering(true)
    try {
      const created = await courseboardApiJson<Customer>('/v1/course/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      setShowCandidates(false)
      onSelect(created)
      // Also listed on the customer ledger screen, so the desk can open the
      // person they registered mid-booking without searching for them again.
      rememberRegisteredCustomer(created)
      showToast({ tone: 'success', message: t('ledger:customer.registered') })
    } catch (registerError) {
      showToast({
        tone: 'danger',
        title: t('ledger:customer.registerFailed'),
        message: registerError instanceof Error ? registerError.message : String(registerError),
      })
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div
      className="ledger-customer-picker"
      // The list floats over the fields below it, so leaving this control has
      // to dismiss it — otherwise it hangs over whatever the desk moved on to.
      // `relatedTarget` is what keeps clicking a candidate from counting as
      // leaving: focus is still inside this container when it lands there.
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setShowCandidates(false)
        }
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && showCandidates) {
          // Stops here so Escape dismisses the list rather than the sheet the
          // desk is still filling in.
          event.stopPropagation()
          setShowCandidates(false)
        }
      }}
    >
      <Input
        value={name}
        placeholder={placeholder}
        disabled={disabled}
        onChange={event => {
          const value = event.target.value
          onNameChange(value)
          setShowCandidates(true)
          // Editing the name unlinks it: the identity was for the name that
          // was there, and keeping it would attach one person's history to
          // another person's name.
          if (customerId) onSelect(null)
        }}
        onFocus={() => setShowCandidates(true)}
      />

      {customerId ? (
        <p className="ledger-customer-picker__linked">
          {/* Member or visitor, for the person now on this row. The desk asks
              this about every name before it prices anything. */}
          <MembershipBadge customerId={customerId} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setShowCandidates(true)
              onSelect(null)
            }}
          >
            {t('ledger:customer.unlink')}
          </Button>
        </p>
      ) : null}

      {showCandidates && !customerId && trimmed.length > 0 ? (
        <div className="ledger-customer-picker__candidates">
          {searching ? <p className="ledger-customer-picker__note">{t('ledger:customer.searching')}</p> : null}
          {error ? (
            // Not a blocker: the booking is still writable without an identity.
            <p className="ledger-customer-picker__note">{t('ledger:customer.searchFailed')}</p>
          ) : null}
          {candidates.map(candidate => {
            const detail = customerDistinguisher(candidate)
            return (
              <button
                type="button"
                className="ledger-customer-picker__candidate"
                key={candidate.id}
                disabled={disabled}
                onClick={() => {
                  setShowCandidates(false)
                  onNameChange(candidate.name)
                  onSelect(candidate)
                }}
              >
                <span className="ledger-customer-picker__candidate-name">{candidate.name}</span>
                {/* Two people share a name often enough that the list is
                    unusable without whatever tells them apart. */}
                {detail ? (
                  <span className="ledger-customer-picker__candidate-detail">{detail}</span>
                ) : null}
              </button>
            )
          })}
          {!searching && !error && completedQuery === trimmed && candidates.length === 0 ? (
            <p className="ledger-customer-picker__note">{t('ledger:customer.noCandidates')}</p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || registering || !trimmed}
            onClick={register}
          >
            {registering ? t('ledger:customer.registering') : t('ledger:customer.register')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
