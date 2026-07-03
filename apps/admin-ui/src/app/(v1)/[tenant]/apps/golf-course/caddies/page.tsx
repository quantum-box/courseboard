import { redirect } from 'next/navigation'

export default function GolfCaddiesAliasPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	redirect(`/${tenant}/extensions/golf-course/caddies`)
}
