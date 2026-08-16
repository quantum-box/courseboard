import { useTranslation } from 'react-i18next'

import { DEFAULT_SEAT_COLUMNS } from './ledgerLayout'

/**
 * The board's shape while the day is still being fetched.
 *
 * The ledger is one Field round trip per course plus the whole booking list, so
 * it is the slowest thing on the page by a wide margin. Blanking the screen for
 * it took the date controls and the course filter away too — the desk could not
 * even correct a mistyped day until the wrong one had finished loading. This
 * stands in for the board alone, in the board's own markup, so nothing moves
 * when the rows arrive.
 */
export function LedgerBoardSkeleton({
  columns,
  rows = 12,
}: {
  /** How many course columns to stand in for. */
  columns: number
  rows?: number
}) {
  const { t } = useTranslation(['ledger'])
  return (
    <div
      className="ledger-board is-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t('ledger:loading')}
    >
      {Array.from({ length: Math.max(columns, 1) }, (_, index) => (
        <SkeletonColumn key={index} rows={rows} />
      ))}
    </div>
  )
}

function SkeletonColumn({ rows }: { rows: number }) {
  const { t } = useTranslation(['ledger'])
  return (
    <section className="ledger-column" aria-hidden="true">
      <header className="ledger-column-head">
        <div className="ledger-column-title">
          <SkeletonBar width="9ch" height={18} />
        </div>
        <p className="ledger-column-totals">
          <SkeletonBar width="15ch" />
        </p>
        <p className="ledger-column-meta">
          <SkeletonBar width="6ch" />
          <SkeletonBar width="7ch" />
        </p>
      </header>

      <div className="ledger-column-scroll">
        <table className="ledger-table">
          <thead>
            <tr>
              <th scope="col" className="ledger-col-time">
                {t('ledger:head.time')}
              </th>
              <th scope="col" className="ledger-col-group">
                {t('ledger:head.group')}
              </th>
              {/* The real board never draws fewer than this, and only widens
                  for a group of five or more — so a column stands in at the
                  width it will almost always keep. */}
              {Array.from({ length: DEFAULT_SEAT_COLUMNS }, (_, index) => (
                <th scope="col" key={index} className="ledger-col-seat">
                  {t('ledger:head.player', { n: String(index + 1) })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, index) => (
              <tr key={index} className="ledger-row">
                <th scope="row" className="ledger-cell-time">
                  <span className="ledger-skeleton-cell">
                    <SkeletonBar width="5ch" />
                  </span>
                </th>
                <td className="ledger-cell-empty" colSpan={DEFAULT_SEAT_COLUMNS + 1}>
                  <span className="ledger-skeleton-cell">
                    {/* Uneven widths down the column: a stack of identical bars
                        reads as a rendered table rather than as one loading. */}
                    <SkeletonBar width={index % 3 === 0 ? '40%' : index % 3 === 1 ? '25%' : '32%'} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function SkeletonBar({
  width,
  height = 12,
}: {
  width: string
  height?: number
}) {
  return <span className="skeleton-bar" style={{ width, height }} aria-hidden="true" />
}
