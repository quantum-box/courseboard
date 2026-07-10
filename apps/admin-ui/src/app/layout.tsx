import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AdminTextTranslator } from 'components/admin-text-translator'
import { AdminI18nProvider } from 'lib/admin-i18n'
import './globals.css'

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Course Board'

export const runtime = 'edge'

export const metadata: Metadata = {
	title: {
		default: SITE_NAME!,
		template: `%s | ${SITE_NAME}`,
	},
	icons: {
		icon: '/favicon.ico',
		apple: '/brand/courseboard-icon-square.png',
	},
}

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	maximumScale: 1,
	userScalable: false,
}

const inter = Inter({ subsets: ['latin'] })

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang='ja' suppressHydrationWarning>
			<body className={inter.className}>
				<AdminI18nProvider>
					<AdminTextTranslator />
					{children}
				</AdminI18nProvider>
			</body>
		</html>
	)
}
