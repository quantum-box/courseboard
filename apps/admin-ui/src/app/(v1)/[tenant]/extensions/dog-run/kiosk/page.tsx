import { redirect } from 'next/navigation'

export default function LegacyKioskRedirect({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	redirect(`/${tenant}/extensions/dog_run/kiosk`)
}
