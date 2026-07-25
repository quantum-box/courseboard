import { Button } from '@tachyon-sdk/native-ui'
import { ChevronRight } from 'lucide-react'
import { golfNavigation } from '../../components/AppShell'
import { PageHeader, Panel } from '../../components/Page'
import { navigate, navigateFromClick } from '../../lib/router'

export function GolfHomePage() {
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Golf operations"
        title="ホーム"
        description="公開予約、コース、キャディ、予算、請求を同じ運用面から管理します。"
        actions={(
          <Button type="button" variant="primary" onClick={() => navigate('golf/timeline')}>
            運用タイムラインを開く
          </Button>
        )}
      />

      <section className="app-section">
        <h2 className="section-title">運用機能</h2>
        <div className="feature-grid" aria-label="運用機能">
          {golfNavigation.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.route}
                type="button"
                className="feature-tile"
                onClick={event => navigateFromClick(event, item.route)}
              >
                <span className="feature-icon"><Icon /></span>
                <span className="feature-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <ChevronRight className="feature-arrow" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </section>

      <Panel title="今日の運用順序" description="マスタ更新から締め処理まで、同じデータを順に引き継ぎます。">
        <div className="operations-track">
          {[
            ['01', 'タイムライン', '当日の予約とキャディ割当を時間軸で確認'],
            ['02', 'キャディ配置', '未割当・衝突を見て配置で担当を確定'],
            ['03', '売上と請求', '予算進捗、キャンセル料、未収を確認'],
            ['04', '月次精算', '予約・費用・Square明細を締める'],
          ].map(([step, label, detail]) => (
            <div key={step} className="operations-step">
              <span>{step}</span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
