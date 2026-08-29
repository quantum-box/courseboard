import { Button } from '@tachyon-sdk/native-ui'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import {
  EmptyState,
  Field,
  LoadingState,
  NativeSelect,
  Notice,
  ResourceError,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'
import { placementWarningStatus, type ShiftPlacementStatus } from './caddiePlacement'
import {
  reassignBlocked,
  reassignTargets,
  type MovableAssignment,
  type MovableRoundRow,
} from './reassignRound'
import { wallClock } from './UnassignedRounds'

const COURSE_API = '/v1/course'

type ListResponse<T> = { items: T[] }

type Candidate = {
  caddieProfileId: string
  displayName: string
  shiftPlacementStatus?: ShiftPlacementStatus | null
}

/** The round being moved, as the day board holds it. */
export type MovingAssignment = MovableAssignment & {
  scheduledAt: string
}

/**
 * Move one round that is already placed: another caddie on the same group,
 * the same caddie on another group, or both.
 *
 * Same-day only, which is what the board is showing and what every check
 * behind it reads. A group somebody else holds is offered but refused — the
 * desk releases that caddie first, rather than the two of them ending up on
 * one group while the second write is in flight.
 */
export function ReassignRoundSheet({
  assignment,
  date,
  rounds,
  assignments,
  caddieNames,
  onClose,
  onMoveDone,
}: {
  assignment: MovingAssignment | null
  date: string
  rounds: MovableRoundRow[]
  assignments: MovableAssignment[]
  caddieNames: Map<string, string>
  onClose: () => void
  onMoveDone: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [caddieProfileId, setCaddieProfileId] = useState('')
  const [reservationId, setReservationId] = useState('')
  const [saving, setSaving] = useState(false)

  const targets = useMemo(
    () =>
      assignment
        ? reassignTargets({
            rows: rounds,
            assignments,
            caddieNames,
            currentAssignmentId: assignment.id,
          })
        : [],
    [assignment, rounds, assignments, caddieNames],
  )
  const currentTarget = targets.find(target => target.isCurrent) ?? null
  const chosenReservationId = reservationId || currentTarget?.reservationId || ''
  const target = targets.find(item => item.reservationId === chosenReservationId) ?? null
  const chosenCaddieId = caddieProfileId || assignment?.caddieProfileId || ''

  // The same ranked list the naming sheet offers, asked for the group being
  // moved to: it already leaves out the day off, the half-day that does not
  // cover the tee time, and anybody on other work.
  const candidates = useResource(
    useCallback(() => {
      if (!assignment || !target) return Promise.resolve({ items: [] as Candidate[] })
      const params = new URLSearchParams({
        scheduledAt: target.teeTime,
        playerCount: String(target.partySize),
        limit: '20',
        golfCourseId: target.golfCourseId,
      })
      return courseboardApiJson<ListResponse<Candidate>>(
        `${COURSE_API}/caddie-recommendations?${params}`,
      )
    }, [assignment, target]),
    [assignment?.id ?? '', target?.reservationId ?? ''],
    { enabled: assignment !== null && target !== null },
  )

  const blocked = reassignBlocked({
    target,
    caddieProfileId: chosenCaddieId,
    currentCaddieProfileId: assignment?.caddieProfileId ?? '',
  })

  function reset() {
    setCaddieProfileId('')
    setReservationId('')
  }

  async function save() {
    if (!assignment || !target || blocked) return
    setSaving(true)
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-assignments/${encodeURIComponent(assignment.id)}/reassignment`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            date,
            caddieProfileId: chosenCaddieId,
            reservationId: target.reservationId,
            scheduledAt: target.teeTime,
          }),
        },
      )
      showToast({
        tone: 'success',
        message: t('caddies:reassign.done', {
          name: caddieNames.get(chosenCaddieId) ?? chosenCaddieId,
          time: wallClock(target.teeTime),
        }),
      })
      reset()
      onMoveDone()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('caddies:reassign.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={assignment !== null}
      onOpenChange={open => {
        if (!open) {
          reset()
          onClose()
        }
      }}
      title={t('caddies:reassign.title')}
      description={
        assignment
          ? t('caddies:reassign.description', {
              name: caddieNames.get(assignment.caddieProfileId) ?? assignment.caddieProfileId,
              time: wallClock(assignment.scheduledAt),
            })
          : undefined
      }
    >
      <div className="space-y-3">
        {targets.length === 0 ? (
          <EmptyState
            title={t('caddies:reassign.noRounds.title')}
            description={t('caddies:reassign.noRounds.description')}
          />
        ) : null}

        {targets.length > 0 ? (
          <Field label={t('caddies:reassign.roundLabel')} requirement="required">
            <NativeSelect
              value={chosenReservationId}
              onChange={event => {
                setReservationId(event.target.value)
                // The candidates are ranked for a tee time and a course, so a
                // different group asks a different question.
                setCaddieProfileId('')
              }}
            >
              {targets.map(item => (
                <option key={item.reservationId} value={item.reservationId}>
                  {[
                    wallClock(item.teeTime),
                    item.partyLabel,
                    item.courseName,
                    item.isCurrent ? t('caddies:reassign.currentRound') : null,
                    item.heldBy ? t('caddies:reassign.heldBy', { name: item.heldBy }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        {blocked === 'taken' ? (
          <Notice tone="warning">{t('caddies:reassign.takenNotice')}</Notice>
        ) : null}

        <Field label={t('caddies:reassign.caddieLabel')} requirement="required">
          <NativeSelect
            value={chosenCaddieId}
            onChange={event => setCaddieProfileId(event.target.value)}
          >
            {assignment ? (
              <option value={assignment.caddieProfileId}>
                {t('caddies:reassign.keepCaddie', {
                  name:
                    caddieNames.get(assignment.caddieProfileId) ?? assignment.caddieProfileId,
                })}
              </option>
            ) : null}
            {(candidates.data?.items ?? [])
              .filter(candidate => candidate.caddieProfileId !== assignment?.caddieProfileId)
              .map(candidate => (
                <option key={candidate.caddieProfileId} value={candidate.caddieProfileId}>
                  {[
                    candidate.displayName,
                    placementWarningStatus(candidate.shiftPlacementStatus)
                      ? t(
                          `caddies:shiftPlacement.${placementWarningStatus(candidate.shiftPlacementStatus)!}`,
                        )
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
          </NativeSelect>
        </Field>

        {candidates.loading ? <LoadingState label={t('caddies:reassign.loading')} /> : null}
        {candidates.error ? (
          <ResourceError error={candidates.error} onRetry={candidates.refresh} />
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t('common:action.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || blocked !== null}
            onClick={() => void save()}
          >
            {saving ? t('common:action.saving') : t('caddies:reassign.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
