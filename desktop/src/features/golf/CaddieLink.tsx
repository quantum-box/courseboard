import { navigateFromClick } from '../../lib/router'

/**
 * A caddie's name, wherever one is shown.
 *
 * The screens all carried their own version of "look up the profile, print
 * `displayName`, fall back to the id" — so a caddie read differently on the
 * assignment board, the attendance list and the shift board, and none of them
 * went anywhere. Whoever the desk is looking at, they usually want the same
 * next thing: that caddie's own screen, where the day-off requests, the staff
 * link and the ratings are.
 *
 * The initial is there to make a column of names scannable at a glance rather
 * than to identify anybody — the name itself is always shown next to it.
 */
export function CaddieLink({
  caddieId,
  displayName,
  fallback,
}: {
  caddieId?: string | null
  displayName?: string | null
  /** Shown when neither a name nor an id is known. */
  fallback?: string
}) {
  const name = displayName?.trim()
  const label = name || caddieId || fallback || '—'

  // Without an id there is nowhere to go. An unlinked row still has to read as
  // a name, so it stays text rather than becoming a button that does nothing.
  if (!caddieId) return <span className="caddie-link-plain">{label}</span>

  return (
    <button
      type="button"
      className="caddie-link"
      onClick={event => navigateFromClick(event, `golf/caddies/${encodeURIComponent(caddieId)}`)}
    >
      <span className="caddie-link-initial" aria-hidden="true">{initialOf(label)}</span>
      <span className="caddie-link-name">{label}</span>
    </button>
  )
}

/**
 * The first character of a name, for the badge.
 *
 * Japanese names start with the family name, so one character already sorts
 * most of a roster. Ids fall back to their first character too, which is
 * meaningless but keeps the row the same height as its neighbours.
 */
function initialOf(label: string): string {
  return [...label.trim()][0] ?? '?'
}
