import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@tachyon-sdk/native-ui'
import type { ReactNode } from 'react'

/**
 * A side panel for secondary detail, so a screen keeps one main thing on it.
 * native-ui has no sheet, but its DialogContent merges classes with twMerge,
 * so the centred modal can be re-anchored to the right edge.
 */
const SHEET_CLASSNAME = [
  // Anchor right, full height, instead of centred.
  'left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-lg translate-x-0 translate-y-0',
  'rounded-none border-y-0 border-r-0',
  // Slide in from the edge rather than zooming from the middle.
  'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  'data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100',
  'flex flex-col gap-4',
].join(' ')

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  className = '',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${SHEET_CLASSNAME} ${className}`}>
        <DialogHeader className="pr-6">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
