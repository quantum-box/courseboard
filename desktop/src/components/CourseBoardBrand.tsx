const BRAND_MARK = '/brand/courseboard-mark.svg'

type CourseBoardBrandProps =
  | { variant: 'sidebar'; collapsed: boolean }
  | { variant: 'auth' }

export function CourseBoardBrand(props: CourseBoardBrandProps) {
  if (props.variant === 'auth') {
    return (
      <>
        <span className="auth-brand-mark" aria-hidden="true">
          <img src={BRAND_MARK} alt="" />
        </span>
        Course Board
      </>
    )
  }

  if (props.collapsed) {
    return (
      <span className="brand-mark">
        <img src={BRAND_MARK} alt="Course Board" />
      </span>
    )
  }

  return (
    <span className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">
        <img src={BRAND_MARK} alt="" />
      </span>
      <span className="brand-name">Course Board</span>
    </span>
  )
}
