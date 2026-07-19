import { Badge, Button } from '@tachyon-sdk/native-ui'
import { RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, courseboardApiJson } from '../../api'
import {
  Field,
  LoadingState,
  NativeTextarea,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useRegisterPageReload } from '../../lib/pageReload'

type ReservationPolicy = {
  metadataJson?: unknown
}

const METADATA_PLACEHOLDER = `{
  "externalSystem": "pms",
  "partnerFacilityCode": "SCC-SORA",
  "syncReservationCode": true,
  "channelCodes": ["web", "rakuten", "jalan"]
}`

function parseMetadata(value: string) {
  try {
    const parsed: unknown = value.trim() ? JSON.parse(value) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: 'metadataJson は JSON オブジェクトで入力してください。' }
    }
    return { value: parsed as Record<string, unknown>, error: null }
  } catch {
    return { value: null, error: 'JSON の構文を確認してください。' }
  }
}

function formatMetadata(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export function IntegrationMetadataPanel() {
  const [draft, setDraft] = useState('{}')
  const [baseline, setBaseline] = useState('{}')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [policyMissing, setPolicyMissing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSaved(false)
    setSaveError(null)
    try {
      const policy = await courseboardApiJson<ReservationPolicy>(
        '/v1/course/reservation-policy',
      )
      const next = formatMetadata(policy.metadataJson)
      setDraft(next)
      setBaseline(next)
      setPolicyMissing(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setDraft('{}')
        setBaseline('{}')
        setPolicyMissing(true)
      } else {
        setLoadError(error)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useRegisterPageReload(load)

  const dirty = draft !== baseline
  const parsed = parseMetadata(draft)

  async function save() {
    setSaved(false)
    if (parsed.error) {
      setSaveError(parsed.error)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await courseboardApiJson<unknown>(
        '/v1/course/reservation-policy',
        {
          method: 'PATCH',
          body: JSON.stringify({ metadataJson: parsed.value }),
        },
      )
      const next = formatMetadata(parsed.value)
      setDraft(next)
      setBaseline(next)
      setPolicyMissing(false)
      setSaved(true)
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : '連携メタデータを保存できませんでした。',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title="連携メタデータ"
      description="予約ポリシーに付与する他システム連携用 JSON です。日常の受付運用では編集不要です。"
      actions={(
        <div className="flex items-center gap-2">
          {dirty ? <Badge variant="outline">未保存</Badge> : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()} disabled={loading || saving} title="⌘R">
            <RefreshCw /> 再読み込み
          </Button>
          <Button type="button" size="sm" variant="primary" onClick={() => void save()} disabled={loading || saving || !dirty}>
            <Save /> {saving ? '保存中…' : 'メタデータを保存'}
          </Button>
        </div>
      )}
    >
      {loading ? <LoadingState label="連携メタデータを読み込んでいます" /> : null}
      {loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError ? (
        <div className="grid gap-3">
          {policyMissing ? (
            <Notice tone="warning" title="予約ポリシーが未作成です">
              先に設定の「テナントマスタ」→「予約ポリシー」で基本設定を保存してから、ここへ連携キーを追加してください。
            </Notice>
          ) : null}

          <Notice tone="info" title="いつ使うか">
            PMS・OTA・会員基盤などへ予約を同期するとき、施設コードやチャネル識別子を載せます。
            現場スタッフの日常操作では触れません。空の {'{}'} のままで問題ありません。
          </Notice>

          <Field
            label="metadataJson"
            hint="JSON オブジェクトのみ · 例はプレースホルダを参照"
          >
            <NativeTextarea
              rows={12}
              className="font-mono text-xs"
              value={draft}
              onChange={event => {
                setDraft(event.target.value)
                setSaved(false)
                setSaveError(null)
              }}
              placeholder={METADATA_PLACEHOLDER}
              spellCheck={false}
            />
          </Field>

          <div className="rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">ユースケース例</p>
            <ul className="list-disc space-y-1 pl-4">
              <li><code>partnerFacilityCode</code> … 外部 PMS の施設コード紐付け</li>
              <li><code>channelCodes</code> … 楽天・じゃらん等チャネル別同期フラグ</li>
              <li><code>syncReservationCode</code> … 予約番号を外部へ返すかどうか</li>
            </ul>
          </div>

          {parsed.error ? (
            <Notice tone="danger" title="JSON を確認してください">{parsed.error}</Notice>
          ) : null}
          {saveError ? (
            <Notice tone="danger" title="保存できませんでした">{saveError}</Notice>
          ) : null}
          {saved ? (
            <Notice tone="success" title="連携メタデータを保存しました">
              予約ポリシーの metadataJson が更新されました。新規予約の連携処理から参照されます。
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
