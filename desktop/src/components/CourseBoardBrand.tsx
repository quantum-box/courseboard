const BRAND_HORIZONTAL_PRIMARY =
  '/brand/generated/2026-07/courseboard-horizontal-primary-transparent.png'
const BRAND_HORIZONTAL_REVERSED =
  '/brand/generated/2026-07/courseboard-horizontal-reversed-transparent.png'
const BRAND_ICON = '/brand/generated/2026-07/courseboard-icon-light.png'

type CourseBoardBrandProps =
  | { variant: 'sidebar'; collapsed: boolean }
  | { variant: 'auth' }

export function CourseBoardBrand(props: CourseBoardBrandProps) {
  if (props.variant === 'auth') {
    // Primary (dark wordmark) is unreadable on the dark green auth panel.
    return (
      <span className="auth-brand-lockup">
        <img src={BRAND_HORIZONTAL_REVERSED} alt="CourseBoard" />
      </span>
    )
  }

  if (props.collapsed) {
    return (
      <span className="brand-mark">
        <img src={BRAND_ICON} alt="CourseBoard" />
      </span>
    )
  }

  return (
    <span className="brand-lockup">
      <img
        className="brand-wordmark"
        src={BRAND_HORIZONTAL_PRIMARY}
        alt="CourseBoard"
      />
    </span>
  )
}
