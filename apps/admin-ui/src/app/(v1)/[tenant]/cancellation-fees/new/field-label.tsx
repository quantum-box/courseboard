import { Label } from 'components/ui/label'
import * as React from 'react'

type FieldLabelProps = {
	children: React.ReactNode
	required?: boolean
	optional?: boolean
}

export function FieldLabel({
	children,
	required = false,
	optional = false,
}: FieldLabelProps) {
	return (
		<Label className='flex items-center gap-2'>
			<span>{children}</span>
			{required || optional ? <RequirementBadge required={required} /> : null}
		</Label>
	)
}

export function RequirementBadge({ required }: { required: boolean }) {
	return (
		<span
			className={
				required
					? 'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full border border-foreground/20 bg-foreground/5 px-1.5 text-[11px] font-medium leading-none text-foreground'
					: 'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-muted/40 px-1.5 text-[11px] font-medium leading-none text-muted-foreground'
			}
		>
			{required ? '必須' : '任意'}
		</span>
	)
}
