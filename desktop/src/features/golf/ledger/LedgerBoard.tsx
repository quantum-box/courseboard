import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { TeeReservation } from '../timeline/models'
import {
  currentSlotTeeTime,
  formatColumnTotals,
  formatGridSource,
  groupTitle,
  knowsRemainingCapacity,
  observedIntervalMinutes,
  remainingGroups,
  seatCells,
  seatColumnCount,
  slotTone,
  type SeatCell,
} from './ledgerLayout'
import type { LedgerColumn, LedgerSlot } from './models'

export type SlotSelection = {
  golfCourseId: string
  teeTimes: string[]
}

/**
 * The start ledger: a table per course, a row per tee time.
 *
 * A real `<table>` rather than a grid of divs — this is tabular data, and the
 * time column has to span the rows of a slot that holds more than one group.
 * Screen readers get the row/column relationship for free, which a div grid
 * would have to reconstruct with ARIA.
 */
export function LedgerBoard({
  columns,
  nowMinutes,
  selection,
  selectedReservationId,
  onToggleSlot,
  onSelectReservation,
  onMoveColumn,
}: {
  columns: LedgerColumn[]
  /** Minutes past midnight in the course's clock, or null on another day. */
  nowMinutes: number | null
  selection: SlotSelection | null
  selectedReservationId: string | null
  onToggleSlot: (golfCourseId: string, teeTime: string, extend: boolean) => void
  onSelectReservation: (id: string) => void
  onMoveColumn: (golfCourseId: string, delta: -1 | 1) => void
}) {
  return (
    <div className="ledger-board">
      {columns.map((column, index) => (
        <LedgerColumnTable
          key={column.golfCourseId}
          column={column}
          nowMinutes={nowMinutes}
          canMoveLeft={index > 0}
          canMoveRight={index < columns.length - 1}
          selectedTeeTimes={
            selection?.golfCourseId === column.golfCourseId ? selection.teeTimes : []
          }
          selectedReservationId={selectedReservationId}
          onToggleSlot={onToggleSlot}
          onSelectReservation={onSelectReservation}
          onMoveColumn={onMoveColumn}
        />
      ))}
    </div>
  )
}

function LedgerColumnTable({
  column,
  nowMinutes,
  canMoveLeft,
  canMoveRight,
  selectedTeeTimes,
  selectedReservationId,
  onToggleSlot,
  onSelectReservation,
  onMoveColumn,
}: {
  column: LedgerColumn
  nowMinutes: number | null
  canMoveLeft: boolean
  canMoveRight: boolean
  selectedTeeTimes: string[]
  selectedReservationId: string | null
  onToggleSlot: (golfCourseId: string, teeTime: string, extend: boolean) => void
  onSelectReservation: (id: string) => void
  onMoveColumn: (golfCourseId: string, delta: -1 | 1) => void
}) {
  const { t } = useTranslation(['ledger'])
  const seatColumns = seatColumnCount(column)
  // Measured from the rows on screen, falling back to what the course record
  // says only when the board is too short to measure.
  const interval = observedIntervalMinutes(column) ?? column.startIntervalMinutes
  const nowTeeTime = currentSlotTeeTime(column.slots, nowMinutes)
  const selected = new Set(selectedTeeTimes)
  const derived = column.gridSource !== 'inventory'

  return (
    <section className="ledger-column" aria-label={column.courseName}>
      <header className="ledger-column-head">
        <div className="ledger-column-title">
          <h2>{column.courseName}</h2>
          <div className="ledger-column-move">
            <button
              type="button"
              aria-label={t('ledger:order.moveLeft', { name: column.courseName })}
              disabled={!canMoveLeft}
              onClick={() => onMoveColumn(column.golfCourseId, -1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={t('ledger:order.moveRight', { name: column.courseName })}
              disabled={!canMoveRight}
              onClick={() => onMoveColumn(column.golfCourseId, 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="ledger-column-totals">{formatColumnTotals(column)}</p>
        <p className="ledger-column-meta">
          <span>{formatGridSource(column.gridSource)}</span>
          {interval ? (
            <span>{t('ledger:column.interval', { n: String(interval) })}</span>
          ) : null}
          {knowsRemainingCapacity(column) ? (
            <span>{t('ledger:column.open', { n: String(column.openSlotCount) })}</span>
          ) : null}
        </p>
        {derived ? (
          <p className="ledger-column-derived">{t('ledger:source.derivedNotice')}</p>
        ) : null}
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
              {Array.from({ length: seatColumns }, (_, index) => (
                <th scope="col" key={index} className="ledger-col-seat">
                  {t('ledger:head.player', { n: String(index + 1) })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {column.slots.map(slot => (
              <SlotRows
                key={slot.teeTime}
                column={column}
                slot={slot}
                seatColumns={seatColumns}
                isNow={slot.teeTime === nowTeeTime}
                isSelected={selected.has(slot.teeTime)}
                selectedReservationId={selectedReservationId}
                onToggleSlot={onToggleSlot}
                onSelectReservation={onSelectReservation}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SlotRows({
  column,
  slot,
  seatColumns,
  isNow,
  isSelected,
  selectedReservationId,
  onToggleSlot,
  onSelectReservation,
}: {
  column: LedgerColumn
  slot: LedgerSlot
  seatColumns: number
  isNow: boolean
  isSelected: boolean
  selectedReservationId: string | null
  onToggleSlot: (golfCourseId: string, teeTime: string, extend: boolean) => void
  onSelectReservation: (id: string) => void
}) {
  const { t } = useTranslation(['ledger'])
  const tone = slotTone(slot)
  // An empty slot is still one row: the empty row is the answer to "what is
  // open at 07:14", so it can never be collapsed away.
  const rowCount = Math.max(slot.items.length, 1)
  const rowClass = [
    'ledger-row',
    `ledger-row-${tone}`,
    isNow ? 'is-now' : '',
    isSelected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
  // The time and the wide empty area are one slot action. Sharing this exact
  // handler keeps Shift-range selection identical whichever part is pressed.
  const selectSlot = (event: MouseEvent<HTMLButtonElement>) => {
    onToggleSlot(column.golfCourseId, slot.teeTime, event.shiftKey)
  }

  const timeCell = (
    <th
      scope="row"
      rowSpan={rowCount}
      className="ledger-cell-time"
      aria-selected={isSelected}
    >
      <button
        type="button"
        className="ledger-time-button"
        onClick={selectSlot}
        aria-pressed={isSelected}
      >
        <time>{slot.teeTime}</time>
        <SlotStatus slot={slot} />
      </button>
      {isNow ? <span className="ledger-now-flag">{t('ledger:now')}</span> : null}
    </th>
  )

  if (slot.items.length === 0) {
    return (
      <tr className={rowClass}>
        {timeCell}
        <td className="ledger-cell-empty" colSpan={seatColumns + 1}>
          <button
            type="button"
            className="ledger-empty-button"
            onClick={selectSlot}
            aria-pressed={isSelected}
          >
            <SlotEmptyLabel slot={slot} />
          </button>
        </td>
      </tr>
    )
  }

  return (
    <Fragment>
      {slot.items.map((item, index) => (
        <tr key={item.id} className={rowClass}>
          {index === 0 ? timeCell : null}
          <GroupCell
            item={item}
            isSelected={selectedReservationId === item.id}
            onSelect={() => onSelectReservation(item.id)}
          />
          {seatCells(item, seatColumns).map((cell, seatIndex) => (
            <SeatCellView key={seatIndex} cell={cell} />
          ))}
        </tr>
      ))}
    </Fragment>
  )
}

/** The badge under the time: what this row is, when it is not just open. */
function SlotStatus({ slot }: { slot: LedgerSlot }) {
  const { t } = useTranslation(['ledger'])
  if (!slot.isActive) return <small className="ledger-slot-status">{t('ledger:cell.retired')}</small>
  if (slot.mark?.kind === 'closed') {
    return (
      <small className="ledger-slot-status">{slot.mark.label || t('ledger:cell.closed')}</small>
    )
  }
  if (slot.mark?.kind === 'special_rate') {
    return (
      <small className="ledger-slot-status">{slot.mark.label || t('ledger:cell.special')}</small>
    )
  }
  return null
}

function SlotEmptyLabel({ slot }: { slot: LedgerSlot }) {
  const { t } = useTranslation(['ledger'])
  const remaining = remainingGroups(slot)
  if (!slot.isActive) return <span>{t('ledger:cell.retired')}</span>
  if (slot.mark?.kind === 'closed') {
    return <span>{slot.mark.label || t('ledger:cell.closed')}</span>
  }
  // The remaining count already says the row is open, so it stands alone; the
  // word is only needed where nothing counted the capacity. Most rows on a
  // quiet day are empty, and repeating "open" down all of them buries the few
  // rows that carry a group.
  return (
    <span>
      {remaining === null
        ? `${t('ledger:cell.open')} · ${t('ledger:cell.capacityUnknown')}`
        : t('ledger:cell.remaining', { n: String(remaining) })}
    </span>
  )
}

function GroupCell({
  item,
  isSelected,
  onSelect,
}: {
  item: TeeReservation
  isSelected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation(['ledger'])
  const organizer = item.party?.organizer?.trim()
  return (
    <td className={`ledger-cell-group${isSelected ? ' is-selected' : ''}`}>
      <button type="button" className="ledger-group-button" onClick={onSelect}>
        <span className={`ledger-play-type ledger-play-type-${item.playType}`}>
          {item.playType === 'caddie' ? 'C' : 'S'}
        </span>
        <span className="ledger-group-text">
          <strong>{groupTitle(item)}</strong>
          {organizer ? <small>{t('ledger:cell.organizer', { name: organizer })}</small> : null}
        </span>
      </button>
    </td>
  )
}

function SeatCellView({ cell }: { cell: SeatCell }) {
  const { t } = useTranslation(['ledger'])
  if (cell.kind === 'empty') return <td className="ledger-cell-seat is-outside" />
  if (cell.kind === 'unnamed') {
    return (
      <td className="ledger-cell-seat is-unnamed">
        <span>{t('ledger:cell.unnamedSeat')}</span>
      </td>
    )
  }
  return (
    <td className="ledger-cell-seat">
      {cell.tag ? <small className="ledger-seat-tag">[{cell.tag}]</small> : null}
      <span className="ledger-seat-name">{cell.name}</span>
    </td>
  )
}
