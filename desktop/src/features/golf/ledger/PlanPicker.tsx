import { useTranslation } from 'react-i18next'

import type { BookablePlan } from './bookablePlan'

/**
 * The plans a course sells, open on the sheet rather than behind a dropdown.
 *
 * Every booking is sold under one, so making the desk open a menu to reach it
 * is one click on every phone call. The list scrolls once a club sells more
 * than fit, and says so: a bar, a faded bottom edge, and a row cut in half.
 */
export function PlanPicker({
  plans,
  value,
  name,
  onChange,
  lockedReason = null,
}: {
  plans: BookablePlan[]
  value: string
  /** Radio group name. Distinct per sheet so two open lists cannot merge. */
  name: string
  onChange: (reservationServiceId: string) => void
  /**
   * Why the plan can no longer change, when it cannot. The list stays on
   * screen so the desk still sees which plan the booking is under.
   */
  lockedReason?: string | null
}) {
  const { t } = useTranslation(['ledger'])
  if (plans.length === 0) return null
  return (
    <fieldset className="ledger-plan-picker" disabled={lockedReason !== null}>
      <legend>{t('ledger:newReservation.plan')}</legend>
      {lockedReason ? <p className="ledger-plan-locked">{lockedReason}</p> : null}
      <div className="ledger-plan-list">
        {plans.map(plan => (
          <label
            key={plan.reservationServiceId}
            className={`ledger-plan-option${
              value === plan.reservationServiceId ? ' is-selected' : ''
            }`}
          >
            <input
              type="radio"
              name={name}
              value={plan.reservationServiceId}
              checked={value === plan.reservationServiceId}
              // The fieldset already disables these in a browser; saying it on
              // each input too is what assistive tech and tests read.
              disabled={lockedReason !== null}
              onChange={() => onChange(plan.reservationServiceId)}
            />
            <span className="ledger-plan-label">{plan.label}</span>
            {/* Caddie or self is what the desk is really choosing between, and
                a plan name does not always say which. The colours are the
                board's, so the badge reads the same in both places. */}
            <span className={`ledger-plan-badge ledger-play-type-${plan.playType}`}>
              {t(`ledger:cell.playType.${plan.playType}`)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
