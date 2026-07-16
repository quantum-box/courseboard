import type { Metadata, Viewport } from 'next'
import './globals.css'

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Course Board'

export const runtime = 'edge'

export const metadata: Metadata = {
	title: SITE_NAME,
	icons: { icon: '/favicon.ico' },
}

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang='ja'>
			<body>{children}</body>
		</html>
	)
}
