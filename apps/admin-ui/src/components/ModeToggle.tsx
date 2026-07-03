'use client'
import { getTogglePath } from 'lib/mode'
import { usePathname, useRouter } from 'next/navigation'

export function ModeToggle({
	isSandbox,
}: {
	isSandbox: boolean
}) {
	const pathname = usePathname()
	const router = useRouter()

	const handleToggle = () => {
		const newPath = getTogglePath(pathname)
		router.push(newPath)
	}

	return (
		<button
			type='button'
			onClick={handleToggle}
			className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold
        transition-all duration-200 cursor-pointer
        ${
					isSandbox
						? 'bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-300'
						: 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-300'
				}
      `}
			aria-label={`Switch to ${isSandbox ? 'production' : 'sandbox'} mode`}
		>
			<span
				className={`
        w-2 h-2 rounded-full
        ${isSandbox ? 'bg-orange-500' : 'bg-green-500'}
      `}
			/>
			{isSandbox ? 'Sandbox' : 'Live'}
		</button>
	)
}
