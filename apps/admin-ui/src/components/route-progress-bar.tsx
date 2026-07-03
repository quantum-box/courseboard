'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const NAVIGATION_START_EVENT = 'tachyon-field:navigation-start'
const SHOW_DELAY_MS = 120
const COMPLETE_DELAY_MS = 180
const MAX_PENDING_MS = 15000

export function announceRouteNavigationStart() {
	if (typeof window === 'undefined') {
		return
	}
	window.dispatchEvent(new Event(NAVIGATION_START_EVENT))
}

function isModifiedClick(event: MouseEvent) {
	return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

function shouldTrackAnchor(anchor: HTMLAnchorElement, event: MouseEvent) {
	if (event.defaultPrevented || event.button !== 0 || isModifiedClick(event)) {
		return false
	}
	if (anchor.target && anchor.target !== '_self') {
		return false
	}
	if (anchor.hasAttribute('download')) {
		return false
	}

	const href = anchor.getAttribute('href')
	if (!href || href.startsWith('#')) {
		return false
	}

	const nextUrl = new URL(anchor.href, window.location.href)
	if (nextUrl.origin !== window.location.origin) {
		return false
	}

	const currentUrl = new URL(window.location.href)
	if (
		nextUrl.pathname === currentUrl.pathname &&
		nextUrl.search === currentUrl.search
	) {
		return false
	}

	return true
}

export function RouteProgressBar() {
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const [isVisible, setIsVisible] = useState(false)
	const [progress, setProgress] = useState(0)
	const isPendingRef = useRef(false)
	const showTimerRef = useRef<number | null>(null)
	const finishTimerRef = useRef<number | null>(null)
	const progressTimerRef = useRef<number | null>(null)
	const maxPendingTimerRef = useRef<number | null>(null)

	const clearTimers = () => {
		if (showTimerRef.current) {
			window.clearTimeout(showTimerRef.current)
			showTimerRef.current = null
		}
		if (finishTimerRef.current) {
			window.clearTimeout(finishTimerRef.current)
			finishTimerRef.current = null
		}
		if (progressTimerRef.current) {
			window.clearInterval(progressTimerRef.current)
			progressTimerRef.current = null
		}
		if (maxPendingTimerRef.current) {
			window.clearTimeout(maxPendingTimerRef.current)
			maxPendingTimerRef.current = null
		}
	}

	const start = () => {
		clearTimers()
		isPendingRef.current = true
		setProgress(12)
		showTimerRef.current = window.setTimeout(() => {
			if (!isPendingRef.current) {
				return
			}
			setIsVisible(true)
			setProgress(28)
			progressTimerRef.current = window.setInterval(() => {
				setProgress(value => Math.min(value + (value < 70 ? 9 : 3), 92))
			}, 260)
		}, SHOW_DELAY_MS)
		maxPendingTimerRef.current = window.setTimeout(() => {
			finish()
		}, MAX_PENDING_MS)
	}

	const finish = () => {
		if (!isPendingRef.current) {
			return
		}
		isPendingRef.current = false
		if (showTimerRef.current) {
			window.clearTimeout(showTimerRef.current)
			showTimerRef.current = null
		}
		if (progressTimerRef.current) {
			window.clearInterval(progressTimerRef.current)
			progressTimerRef.current = null
		}
		if (maxPendingTimerRef.current) {
			window.clearTimeout(maxPendingTimerRef.current)
			maxPendingTimerRef.current = null
		}
		setProgress(100)
		finishTimerRef.current = window.setTimeout(() => {
			setIsVisible(false)
			setProgress(0)
			finishTimerRef.current = null
		}, COMPLETE_DELAY_MS)
	}

	useEffect(() => {
		const handleClick = (event: MouseEvent) => {
			const target = event.target
			if (!(target instanceof Element)) {
				return
			}
			const anchor = target.closest('a[href]')
			if (!(anchor instanceof HTMLAnchorElement)) {
				return
			}
			if (shouldTrackAnchor(anchor, event)) {
				start()
			}
		}
		const handleRouteStart = () => start()

		document.addEventListener('click', handleClick, true)
		window.addEventListener(NAVIGATION_START_EVENT, handleRouteStart)
		return () => {
			document.removeEventListener('click', handleClick, true)
			window.removeEventListener(NAVIGATION_START_EVENT, handleRouteStart)
			clearTimers()
		}
	}, [])

	useEffect(() => {
		finish()
	}, [pathname, searchParams])

	return (
		<div
			aria-hidden='true'
			className={`pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden bg-transparent transition-opacity duration-150 ${
				isVisible ? 'opacity-100' : 'opacity-0'
			}`}
		>
			<div
				className='h-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 shadow-[0_0_12px_rgba(14,165,233,0.75)] transition-[width] duration-200 ease-out'
				style={{ width: `${progress}%` }}
			/>
		</div>
	)
}
