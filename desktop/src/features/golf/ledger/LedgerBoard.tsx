import { Tooltip, TooltipContent, TooltipTrigger } from '@tachyon-sdk/native-ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Fragment, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { CourseCaddieSupply } from '../caddieCourseSupply'
import type { CoverageAssignment } from '../caddieRoundCoverage'
import type { TeeReservation } from '../timeline/models'
import type { SlotContextTarget } from './SlotContextMenu'
import {
  currentSlotTeeTime,
  formatCaddieCapacity,
  formatCaddieShortfall,
  formatColumnTotals,
  formatGridSource,
  groupTitle,
  knowsCaddieCapacity,
  knowsRemainingCapacity,
  observedIntervalMinutes,
  remainingGroups,
  seatCells,
  seatColumnCount,
  slotTone,
  unassignedCaddieReservationIds,
  type ResourceStatus,
  type SeatCell,
} from './ledgerLayout'
import type { LedgerColumn, LedgerSlot } from './models'
import {
  reservationBlockReason,
  type ReservationBlockReason,
} from './newReservation'

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
  caddieSupply,
  shiftsConfirmed,
  assignments,
  nowMinutes,
  selection,
  selectedReservationId,
  onToggleSlot,
  onBookSlot,
  onOpenContextMenu,
  onSelectReservation,
  onMoveColumn,
  onOpenCourseSetup,
}: {
  columns: LedgerColumn[]
  /** Today's caddie room per course. Empty when the lookup has not landed. */
  caddieSupply: Map<string, CourseCaddieSupply>
  /** Whether the day has at least one confirmed caddie shift (day-wide, not
   *  per course). `unknown`/`failed` states are folded to `false` by the
   *  caller so this component only ever sees a plain boolean. */
  shiftsConfirmed: boolean
  /** Today's caddie assignments. Only `loaded` yields an unassigned badge. */
  assignments: ResourceStatus<{ items: CoverageAssignment[] }>
  /** Minutes past midnight in the course's clock, or null on another day. */
  nowMinutes: number | null
  selection: SlotSelection | null
  selectedReservationId: string | null
  onToggleSlot: (golfCourseId: string, teeTime: string, extend: boolean) => void
  onBookSlot: (golfCourseId: string, teeTime: string) => void
  onOpenContextMenu: (target: SlotContextTarget) => void
  onSelectReservation: (id: string) => void
  onMoveColumn: (golfCourseId: string, delta: -1 | 1) => void
  onOpenCourseSetup: (golfCourseId: string) => void
}) {
  const unassignedIds = useMemo(
    () => unassignedCaddieReservationIds(columns, assignments),
    [columns, assignments],
  )
  return (
    <div className="ledger-board">
      {columns.map((column, index) => (
        <LedgerColumnTable
          key={column.golfCourseId}
          column={column}
          caddieSupply={caddieSupply.get(column.golfCourseId) ?? null}
          shiftsConfirmed={shiftsConfirmed}
          unassignedIds={unassignedIds}
          nowMinutes={nowMinutes}
          canMoveLeft={index > 0}
          canMoveRight={index < columns.length - 1}
          selectedTeeTimes={
            selection?.golfCourseId === column.golfCourseId ? selection.teeTimes : []
          }
          selectedReservationId={selectedReservationId}
          onToggleSlot={onToggleSlot}
          onBookSlot={onBookSlot}
          onOpenContextMenu={onOpenContextMenu}
          onSelectReservation={onSelectReservation}
          onMoveColumn={onMoveColumn}
          onOpenCourseSetup={onOpenCourseSetup}
        />
      ))}
    </div>
  )
}

function LedgerColumnTable({
  column,
  caddieSupply,
  shiftsConfirmed,
  unassignedIds,
  nowMinutes,
  canMoveLeft,
  canMoveRight,
  selectedTeeTimes,
  selectedReservationId,
  onToggleSlot,
  onBookSlot,
  onOpenContextMenu,
  onSelectReservation,
  onMoveColumn,
  onOpenCourseSetup,
}: {
  column: LedgerColumn
  caddieSupply: CourseCaddieSupply | null
  shiftsConfirmed: boolean
  unassignedIds: Set<string>
  nowMinutes: number | null
  canMoveLeft: boolean
  canMoveRight: boolean
  selectedTeeTimes: string[]
  selectedReservationId: string | null
  onToggleSlot: (golfCourseId: string, teeTime: string, extend: boolean) => void
  onBookSlot: (golfCourseId: string, teeTime: string) => void
  onOpenContextMenu: (target: SlotContextTarget) => void
  onSelectReservation: (id: string) => void
  onMoveColumn: (golfCourseId: string, delta: -1 | 1) => void
  onOpenCourseSetup: (golfCourseId: string) => void
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
          {/* The heading is the obvious thing to reach for when the desk wants
              this course's setup, so it carries the link rather than making
              them find the same course again in the course list. */}
          <h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="ledger-column-name"
                  onClick={() => onOpenCourseSetup(column.golfCourseId)}
                >
                  {column.courseName}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('ledger:source.openCourseSetup')}
              </TooltipContent>
            </Tooltip>
          </h2>
          {/* Two unlabelled chevrons on a header say nothing about what they
              move. The name is on the tooltip rather than "left"/"right" alone,
              so a board of four columns still reads which one is about to go.
              A disabled arrow gets no tooltip — it also does nothing. */}
          <div className="ledger-column-move">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('ledger:order.moveLeft', { name: column.courseName })}
                  disabled={!canMoveLeft}
                  onClick={() => onMoveColumn(column.golfCourseId, -1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('ledger:order.moveLeft', { name: column.courseName })}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('ledger:order.moveRight', { name: column.courseName })}
                  disabled={!canMoveRight}
                  onClick={() => onMoveColumn(column.golfCourseId, 1)}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('ledger:order.moveRight', { name: column.courseName })}
              </TooltipContent>
            </Tooltip>
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
          {/* Open slots say what the course can start; this says how many of
              those it can still staff. The desk was reading one number here
              and the other on the caddie screen, which is two places to look
              before answering the phone. */}
          {knowsCaddieCapacity(caddieSupply) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={
                    caddieSupply.shortfall < 0 ? 'ledger-column-oversold' : undefined
                  }
                >
                  {formatCaddieCapacity(caddieSupply)} · {formatCaddieShortfall(caddieSupply)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('ledger:column.caddieHint', {
                  caddies: String(caddieSupply.workingCaddies),
                  capacity: String(caddieSupply.roundsCapacity),
                  booked: String(caddieSupply.caddieAttachedGroups),
                })}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </p>
        {/* The notice used to state the problem and stop there, leaving the desk
            to work out that the answer lives on the course's own screen. It is
            two clicks from here, so the notice carries the way there. */}
        {derived ? (
          <p className="ledger-column-derived">
            {t('ledger:source.derivedNotice')}{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => onOpenCourseSetup(column.golfCourseId)}
            >
              {t('ledger:source.openCourseSetup')}
            </button>
          </p>
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
                shiftsConfirmed={shiftsConfirmed}
                unassignedIds={unassignedIds}
                isNow={slot.teeTime === nowTeeTime}
                isSelected={selected.has(slot.teeTime)}
                selectedReservationId={selectedReservationId}
                onToggleSlot={onToggleSlot}
                onBookSlot={onBookSlot}
                onOpenContextMenu={onOpenContextMenu}
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
  shiftsConfirmed,
  unassignedIds,
  isNow,
  isSelected,
  selectedReservationId,
  onToggleSlot,
  onBookSlot,
  onOpenContextMenu,
  onSelectReservation,
}: {
  column: LedgerColumn
  slot: LedgerSlot
  seatColumns: number
  shiftsConfirmed: boolean
  unassignedIds: Set<string>
  isNow: boolean
  isSelected: boolean
  selectedReservationId: string | null
  onToggleSlot: (golfCourseId: string, teeTime: string, extend: boolean) => void
  onBookSlot: (golfCourseId: string, teeTime: string) => void
  onOpenContextMenu: (target: SlotContextTarget) => void
  onSelectReservation: (id: string) => void
}) {
  const { t } = useTranslation(['ledger'])
  const tone = slotTone(slot)
  const bookingBlock = reservationBlockReason({ column, slot })
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
        onClick={event => onToggleSlot(column.golfCourseId, slot.teeTime, event.shiftKey)}
        aria-pressed={isSelected}
      >
        <time>{slot.teeTime}</time>
        <SlotStatus slot={slot} />
      </button>
      {isNow ? <span className="ledger-now-flag">{t('ledger:now')}</span> : null}
    </th>
  )

  /** Right-click is the way to everything a row can do, booked or not. */
  const contextMenuHandler =
    (item?: TeeReservation) => (event: ReactMouseEvent<HTMLTableRowElement>) => {
      event.preventDefault()
      onOpenContextMenu({
        x: event.clientX,
        y: event.clientY,
        golfCourseId: column.golfCourseId,
        courseName: column.courseName,
        teeTime: slot.teeTime,
        reservationId: item?.id,
        reservationName: item?.partyName,
        canBook: slot.items.length === 0 && bookingBlock === null,
      })
    }

  if (slot.items.length === 0) {
    return (
      <tr className={rowClass} onContextMenu={contextMenuHandler()}>
        {timeCell}
        <td className="ledger-cell-empty" colSpan={seatColumns + 1}>
          {/* Booking is what the desk does with an open row, and a phone
              caller is waiting, so a plain click goes straight to the form.
              Marking keeps the time column, and shift still extends a range. */}
          <button
            type="button"
            className="ledger-empty-button"
            onClick={event => {
              if (event.shiftKey || bookingBlock !== null) {
                onToggleSlot(column.golfCourseId, slot.teeTime, event.shiftKey)
                return
              }
              onBookSlot(column.golfCourseId, slot.teeTime)
            }}
            aria-pressed={isSelected}
          >
            <SlotEmptyLabel slot={slot} bookingBlock={bookingBlock} />
          </button>
        </td>
      </tr>
    )
  }

  return (
    <Fragment>
      {slot.items.map((item, index) => (
        <tr
          key={item.id}
          className={`${rowClass} is-booked`}
          onContextMenu={contextMenuHandler(item)}
          // The whole row is the group, so anywhere on it opens the group's
          // sheet — the desk clicks the seat it means to fill rather than
          // tracking back to the name in the first column. Cells that carry
          // their own control (the time button, the group button) answer for
          // themselves; this only picks up the clicks nothing else wanted.
          onClick={event => {
            if ((event.target as HTMLElement).closest('button, a, input, select')) return
            onSelectReservation(item.id)
          }}
        >
          {index === 0 ? timeCell : null}
          <GroupCell
            item={item}
            isSelected={selectedReservationId === item.id}
            shiftsConfirmed={shiftsConfirmed}
            unassignedIds={unassignedIds}
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

function SlotEmptyLabel({
  slot,
  bookingBlock,
}: {
  slot: LedgerSlot
  bookingBlock: ReservationBlockReason | null
}) {
  const { t } = useTranslation(['ledger'])
  const remaining = remainingGroups(slot)
  if (bookingBlock) {
    const labels: Record<ReservationBlockReason, string> = {
      full: t('ledger:newReservation.blockLabel.full'),
      stopped: slot.mark?.label || t('ledger:newReservation.blockLabel.stopped'),
      missingInventory: t('ledger:newReservation.blockLabel.missingInventory'),
      missingResource: t('ledger:newReservation.blockLabel.missingResource'),
      notSellable: t('ledger:newReservation.blockLabel.notSellable'),
    }
    return <span className="ledger-reservation-block-label">{labels[bookingBlock]}</span>
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
  shiftsConfirmed,
  unassignedIds,
  onSelect,
}: {
  item: TeeReservation
  isSelected: boolean
  shiftsConfirmed: boolean
  unassignedIds: Set<string>
  onSelect: () => void
}) {
  const { t } = useTranslation(['ledger'])
  const organizer = item.party?.organizer?.trim()
  const isUnassignedCaddie =
    item.playType === 'caddie' && shiftsConfirmed && unassignedIds.has(item.id)
  return (
    <td
      className={`ledger-cell-group${isSelected ? ' is-selected' : ''}${
        isUnassignedCaddie ? ' is-unassigned-caddie' : ''
      }`}
    >
      <button type="button" className="ledger-group-button" onClick={onSelect}>
        <span className={`ledger-play-type ledger-play-type-${item.playType}`}>
          {item.playType === 'caddie' ? 'C' : 'S'}
        </span>
        <span className="ledger-group-text">
          <strong>{groupTitle(item)}</strong>
          {organizer ? <small>{t('ledger:cell.organizer', { name: organizer })}</small> : null}
          {isUnassignedCaddie ? (
            <small className="ledger-unassigned-badge">
              {t('ledger:cell.unassignedCaddie')}
            </small>
          ) : null}
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
