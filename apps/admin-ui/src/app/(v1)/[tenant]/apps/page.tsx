import { redirect } from 'next/navigation'

export default function AppsAliasPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	redirect(`/${tenant}/extensions`)
}
