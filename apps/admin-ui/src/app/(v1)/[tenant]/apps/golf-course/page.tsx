import { redirect } from 'next/navigation'

export default function GolfAppAliasPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	redirect(`/${tenant}/extensions/golf-course`)
}
