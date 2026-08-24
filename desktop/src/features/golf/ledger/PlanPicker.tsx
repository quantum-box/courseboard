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
  caddieSoldOut = false,
}: {
  plans: BookablePlan[]
  value: string
  /** Radio group name. Distinct per sheet so two open lists cannot merge. */
  name: string
  onChange: (reservationServiceId: string) => void
  /**
   * Today's caddies are already spoken for on this course.
   *
   * Only the caddie plans go out of reach — the same tee time is still sellable
   * as self-play, so refusing the whole row would turn away a round the club
   * can take. Defaults to false: an unknown or missing capacity must not lock
   * the desk out of caddie rounds.
   */
  caddieSoldOut?: boolean
}) {
  const { t } = useTranslation(['ledger'])
  if (plans.length === 0) return null
  return (
    <fieldset className="ledger-plan-picker">
      <legend>{t('ledger:newReservation.plan')}</legend>
      <div className="ledger-plan-list">
        {plans.map(plan => {
          const soldOut = caddieSoldOut && plan.playType === 'caddie'
          return (
            <label
              key={plan.reservationServiceId}
              className={`ledger-plan-option${
                value === plan.reservationServiceId ? ' is-selected' : ''
              }${soldOut ? ' is-sold-out' : ''}`}
            >
              <input
                type="radio"
                name={name}
                value={plan.reservationServiceId}
                checked={value === plan.reservationServiceId}
                disabled={soldOut}
                onChange={() => onChange(plan.reservationServiceId)}
              />
              <span className="ledger-plan-label">{plan.label}</span>
              {/* Caddie or self is what the desk is really choosing between, and
                  a plan name does not always say which. The colours are the
                  board's, so the badge reads the same in both places. */}
              <span className={`ledger-plan-badge ledger-play-type-${plan.playType}`}>
                {t(`ledger:cell.playType.${plan.playType}`)}
              </span>
              {/* Greying a row out without saying why reads as a bug. The desk
                  needs to know it is the caddie room that is full, not the
                  tee sheet, because the answer is to call a caddie in. */}
              {soldOut ? (
                <span className="ledger-plan-sold-out">
                  {t('ledger:newReservation.caddieSoldOut')}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
