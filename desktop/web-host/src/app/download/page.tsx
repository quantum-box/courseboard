import type { Metadata } from 'next'
import Image from 'next/image'

export const metadata: Metadata = {
	title: 'Course Boardをダウンロード',
	description: 'Course BoardのmacOS・Windows・モバイルアプリを入手できます。',
}

const releaseBaseUrl = (
	process.env.COURSEBOARD_DESKTOP_RELEASE_BASE_URL ??
	'https://downloads.courseboard.txcloud.app'
).replace(/\/$/, '')

const desktopDownloads = [
	{
		name: 'macOS（Apple Silicon）',
		description: 'M1以降のMac用DMG',
		href: `${releaseBaseUrl}/releases/latest/courseboard-macos-arm64.dmg`,
	},
	{
		name: 'Windows（64-bit）',
		description: 'Windows 10・11用インストーラー',
		href: `${releaseBaseUrl}/releases/latest/courseboard-windows-x64.msi`,
	},
]

export default function DownloadPage() {
	return (
		<main className="min-h-screen bg-slate-950 px-6 py-16 text-white">
			<div className="mx-auto max-w-5xl">
				<header className="mb-14 flex items-center gap-4">
					<Image
						src="/brand/courseboard-icon-square.png"
						alt="Course Board"
						width={64}
						height={64}
						className="rounded-2xl"
					/>
					<div>
						<p className="text-sm font-semibold tracking-[0.2em] text-emerald-300">
							COURSE BOARD
						</p>
						<h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
							いつもの端末で、コース運営を。
						</h1>
					</div>
				</header>

				<section aria-labelledby="desktop-downloads">
					<div className="mb-6">
						<h2 id="desktop-downloads" className="text-2xl font-semibold">
							Desktopアプリ
						</h2>
						<p className="mt-2 text-slate-300">
							お使いのOSに合った最新版をダウンロードしてください。
						</p>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						{desktopDownloads.map((download) => (
							<a
								key={download.name}
								href={download.href}
								className="group rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-emerald-300/60 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-300"
							>
								<span className="block text-lg font-semibold group-hover:text-emerald-200">
									{download.name}
								</span>
								<span className="mt-2 block text-sm text-slate-300">
									{download.description}
								</span>
								<span className="mt-5 block text-sm font-semibold text-emerald-300">
									最新版をダウンロード →
								</span>
							</a>
						))}
					</div>
				</section>

				<section className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-6">
					<h2 className="text-xl font-semibold">Mobileアプリ</h2>
					<p className="mt-2 text-slate-300">
						iPhone・iPad版はApp Store、Android版はGoogle Playで順次公開します。
					</p>
				</section>

				<footer className="mt-10 text-sm text-slate-400">
					<a
						href={`${releaseBaseUrl}/releases/latest.json`}
						className="underline decoration-slate-600 underline-offset-4 hover:text-white"
					>
						リリース情報とチェックサム
					</a>
				</footer>
			</div>
		</main>
	)
}
