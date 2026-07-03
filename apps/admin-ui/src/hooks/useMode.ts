'use client'
import {
	type TachyonFieldMode,
	getModeFromPathname,
	getPathWithMode,
} from 'lib/mode'
import { usePathname } from 'next/navigation'

export function useMode(): TachyonFieldMode {
	const pathname = usePathname()
	return getModeFromPathname(pathname)
}

export function useModePrefix(): string {
	const mode = useMode()
	return mode === 'sandbox' ? '/sandbox' : ''
}

export function useModePath(path: string): string {
	const mode = useMode()
	return getPathWithMode(path, mode)
}
