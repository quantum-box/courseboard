import { Button } from './ui/button'

export function ActionButton({
	action,
	children,
	formClassName,
	...props
}: {
	action: React.FormHTMLAttributes<HTMLFormElement>['action']
	formClassName?: string
} & React.ComponentPropsWithRef<typeof Button>) {
	return (
		<form action={action} className={formClassName}>
			<Button {...props}>{children}</Button>
		</form>
	)
}
