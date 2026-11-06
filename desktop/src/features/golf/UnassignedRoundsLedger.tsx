import { Button } from '@tachyon-sdk/native-ui'
import { UserPlus } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { LedgerGroupCell, LedgerSeatCell } from './ledger/LedgerBoard'
import { seatCells } from './ledger/ledgerLayout'
import type { TeeReservation } from './timeline/models'
import type { TeeSheetRow } from './UnassignedRounds'

function reservationForLedger(round: TeeSheetRow): TeeReservation {
  return {
    ...round,
    partyName: round.partyName || round.reservationNumber,
    playType: 'caddie',
    status: 'confirmed',
    durationMinutes: round.durationMinutes ?? 270,
    holes: 18,
  }
}

/** The same group and player cells as the booking ledger, with assignment as
 * the row action. Empty cells provide time context, never a booking action. */
export function UnassignedRoundsLedger({
  rounds,
  courseOrder,
  selectedId,
  onSelect,
}: {
  rounds: TeeSheetRow[]
  courseOrder: string[]
  selectedId: string | null
  onSelect: (round: TeeSheetRow) => void
}) {
  const { t } = useTranslation(['caddies', 'ledger'])
  const courses = useMemo(() => {
    const grouped = new Map<string, { name: string; rounds: TeeSheetRow[] }>()
    for (const round of rounds) {
      const course = grouped.get(round.golfCourseId)
      if (course) course.rounds.push(round)
      else grouped.set(round.golfCourseId, { name: round.courseName, rounds: [round] })
    }
    return [...grouped].sort(([left], [right]) => courseOrder.indexOf(left) - courseOrder.indexOf(right)).map(([id, course]) => ({
      id,
      ...course,
      seats: Math.min(8, Math.max(4, ...course.rounds.map(round =>
        Math.max(round.partySize, round.party?.players.length ?? 0)))),
    }))
  }, [rounds, courseOrder])
  const times = useMemo(
    () => [...new Set(rounds.map(round => round.teeTime.slice(11, 16)))].sort(),
    [rounds],
  )
  const unassignedIds = useMemo(() => new Set(rounds.map(round => round.id)), [rounds])
  // A simultaneous multi-group start gets the same height in every course.
  const rowsPerTime = useMemo(() => new Map(times.map(time => [time,
    Math.max(...courses.map(course => course.rounds.filter(
      round => round.teeTime.slice(11, 16) === time,
    ).length)),
  ])), [courses, times])

  return (
    <div className="dispatch-ledger-scroll" tabIndex={0} role="region" aria-label={t('caddies:unassigned.ledgerLabel')}>
      <div className="ledger-board dispatch-ledger">
        {courses.map(course => (
          <section className="ledger-column" key={course.id} aria-label={course.name}>
            <header className="ledger-column-head">
              <h3>{course.name}</h3>
              <p className="ledger-column-totals">
                {t('caddies:unassigned.pendingCount', { n: String(course.rounds.length) })}
              </p>
            </header>
            <table className="ledger-table" style={{ width: 76 + 190 + 108 * course.seats + 148 }}>
              <thead>
                <tr>
                  <th scope="col" className="ledger-col-time">{t('ledger:head.time')}</th>
                  <th scope="col" className="ledger-col-group">{t('ledger:head.group')}</th>
                  {Array.from({ length: course.seats }, (_, index) => (
                    <th scope="col" className="ledger-col-seat" key={index}>
                      {t('ledger:head.player', { n: String(index + 1) })}
                    </th>
                  ))}
                  <th scope="col" className="dispatch-ledger-col-action">{t('caddies:unassigned.assignmentColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {times.map(time => {
                  const atTime = course.rounds.filter(round => round.teeTime.slice(11, 16) === time)
                  const count = rowsPerTime.get(time) ?? 1
                  return (
                    <Fragment key={time}>
                      {Array.from({ length: count }, (_, index) => {
                        const round = atTime[index]
                        return (
                          <tr
                            key={round?.id ?? `${time}-${index}`}
                            className={`ledger-row dispatch-ledger-row${round ? ' is-booked' : ''}${selectedId === round?.id ? ' is-selected' : ''}`}
                            onClick={round ? event => {
                              if ((event.target as HTMLElement).closest('button, a')) return
                              onSelect(round)
                            } : undefined}
                          >
                            {index === 0 ? (
                              <th scope="row" rowSpan={count} className="ledger-cell-time">
                                <time className="dispatch-ledger-time">{time}</time>
                              </th>
                            ) : null}
                            {round ? (
                              <>
                                <LedgerGroupCell item={reservationForLedger(round)} isSelected={selectedId === round.id}
                                  shiftsConfirmed unassignedIds={unassignedIds} onSelect={() => onSelect(round)} />
                                {seatCells(reservationForLedger(round), course.seats).map((cell, seat) => (
                                  <LedgerSeatCell key={seat} cell={cell} />
                                ))}
                                <td className="dispatch-ledger-action">
                                  <Button type="button" variant="secondary" size="sm"
                                    aria-label={t('caddies:unassigned.assignRound', { time, name: round.partyName || round.reservationNumber })}
                                    onClick={() => onSelect(round)}>
                                    <UserPlus aria-hidden="true" />{t('caddies:unassigned.name')}
                                  </Button>
                                </td>
                              </>
                            ) : (
                              <td colSpan={course.seats + 2} className="dispatch-ledger-empty">—</td>
                            )}
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  )
}
