import { useTranslation } from 'react-i18next'
import { Notice } from '../../components/Page'
import type { ReservationStatus } from './reservation-status'

/** Names and numbers stay together in the source row; no model transcription. */
export function ReservationStatusCard({ status }: { status: ReservationStatus }) {
  const { t } = useTranslation('agent')
  return <article className="agent-reservation-result" aria-label={t('chat.breakdown.title', { date: status.date })}>
    <h2>{t('chat.breakdown.title', { date: status.date })}</h2>
    {status.reservationTotals ? <p className="agent-reservation-total">
      {t('chat.reservationTotals', { date: status.date, groups: status.reservationTotals.groups, players: status.reservationTotals.players })}
    </p> : <Notice tone="warning">{t('chat.reservationIncomplete')}</Notice>}
    {status.courses.length ? <div className="agent-markdown agent-reservation-table">
      <table>
        <caption>{t('chat.breakdown.source')}</caption>
        <thead><tr>
          <th scope="col">{t('chat.breakdown.course')}</th>
          <th scope="col">{t('chat.breakdown.groups')}</th>
          <th scope="col">{t('chat.breakdown.players')}</th>
          <th scope="col">{t('chat.breakdown.self')}</th>
          <th scope="col">{t('chat.breakdown.caddie')}</th>
        </tr></thead>
        <tbody>{status.courses.map((course, index) => <tr key={`${course.courseId}:${index}`}>
          <th scope="row">{course.courseName}</th>
          <td>{course.groups}</td><td>{course.players}</td><td>{course.selfGroups}</td><td>{course.caddieGroups}</td>
        </tr>)}</tbody>
        {status.reservationTotals ? <tfoot><tr><th scope="row">{t('chat.breakdown.total')}</th>
          <td>{status.reservationTotals.groups}</td><td>{status.reservationTotals.players}</td>
          <td>{status.reservationTotals.selfGroups}</td><td>{status.reservationTotals.caddieGroups}</td>
        </tr></tfoot> : null}
      </table>
    </div> : null}
    {status.complete ? <p>{status.remainingCapacity.complete
      ? t('chat.breakdown.capacity', { count: status.remainingCapacity.knownOpenSlots })
      : t('chat.breakdown.capacityPartial', { count: status.remainingCapacity.knownOpenSlots, missing: status.remainingCapacity.uncountedCourses })}</p> : null}
  </article>
}
