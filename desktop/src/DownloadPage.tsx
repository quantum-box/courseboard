import { Download } from 'lucide-react'

const releaseBaseUrl = (
  import.meta.env.VITE_COURSEBOARD_DESKTOP_RELEASE_BASE_URL
  ?? 'https://downloads.courseboard.txcloud.app'
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

export function DownloadPage() {
  return (
    <main className="download-page">
      <div className="download-shell">
        <header className="download-header">
          <p>COURSE BOARD</p>
          <h1>いつもの端末で、コース運営を。</h1>
          <span>Course Boardのデスクトップ版をダウンロードできます。</span>
        </header>

        <section aria-labelledby="desktop-downloads">
          <h2 id="desktop-downloads">Desktopアプリ</h2>
          <div className="download-grid">
            {desktopDownloads.map(download => (
              <a key={download.name} href={download.href} className="download-card">
                <Download aria-hidden="true" />
                <strong>{download.name}</strong>
                <span>{download.description}</span>
                <small>最新版をダウンロード →</small>
              </a>
            ))}
          </div>
        </section>

        <section className="download-mobile">
          <h2>Mobileアプリ</h2>
          <p>iPhone・iPad版はApp Store、Android版はGoogle Playで順次公開します。</p>
        </section>

        <a className="download-release-link" href={`${releaseBaseUrl}/releases/latest.json`}>
          リリース情報とチェックサム
        </a>
      </div>
    </main>
  )
}
