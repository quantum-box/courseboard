import { auth, authRedirectUrl } from 'app/auth'
import { Toaster } from 'components/ui/toaster'
import { TooltipProvider } from 'components/ui/tooltip'
import { SessionProvider } from 'next-auth/react'
import { redirect } from 'next/navigation'

export default async function Layout({
	children,
}: {
	children: React.ReactNode
}) {
	const session = await auth()
	if (!session) {
		redirect(authRedirectUrl('/auth/sign_in'))
	}
	return (
		<SessionProvider session={session}>
			<TooltipProvider>
				{children}
				<Toaster />
			</TooltipProvider>
		</SessionProvider>
	)
}
