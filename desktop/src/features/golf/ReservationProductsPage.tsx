import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  CalendarDays,
  Check,
  ClipboardCheck,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { courseboardApiJson, fieldTenant } from '../../api'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  Notice,
  PageHeader,
  PageRefreshButton,
  Panel,
  ResourceError,
  type DataTableColumn,
} from '../../components/Page'
import {
  applyCapacityToSlots,
  calculateCaddieCapacity,
  defaultDuration,
  emptyProductDraft,
  emptySlot,
  normalizeSlot,
  productToDraft,
  validateSlots,
  weekdayLabels,
  type CapacityAvailability,
  type CapacityProfile,
  type CaddieSlotCapacity,
  type GolfProductSlot,
  type GolfReservationProduct,
  type GolfReservationProductDraft,
  type PlayType,
} from './models'

const productsPath = '/v1/course/reservation-products'
const caddieProfilesPath = '/v1/course/caddie-profiles'
const caddieAvailabilitiesPath = '/v1/course/caddie-availabilities'

type EditableSlot = GolfProductSlot & { clientKey: string }

type ProductEditorState =
  | { mode: 'create' }
  | { mode: 'edit'; serviceId: string }
  | null

type PageMessage = {
  tone: 'success' | 'info'
  title: string
  body: string
}

let clientSlotSequence = 0

function slotsPath(serviceId: string) {
  return `${productsPath}/${encodeURIComponent(serviceId)}/slots`
}

function toEditableSlot(slot: GolfProductSlot): EditableSlot {
  clientSlotSequence += 1
  return {
    ...normalizeSlot(slot),
    clientKey: slot.id ?? `local-slot-${clientSlotSequence}`,
  }
}

function newEditableSlot(weekday = 1): EditableSlot {
  return toEditableSlot(emptySlot(weekday))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作を完了できませんでした。'
}

function formatUpdatedAt(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function todayInTokyo() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function validateProduct(draft: GolfReservationProductDraft) {
  if (!draft.serviceId.trim()) return '予約サービスIDを入力してください。'
  if (!/^[A-Za-z0-9._:-]+$/.test(draft.serviceId.trim())) {
    return '予約サービスIDには英数字、ピリオド、ハイフン、アンダースコア、コロンを使用できます。'
  }
  if (![9, 18].includes(draft.holeCount)) return 'ホール数は9Hまたは18Hを選択してください。'
  if (
    !Number.isInteger(draft.expectedDurationMinutes)
    || draft.expectedDurationMinutes < 30
    || draft.expectedDurationMinutes > 720
  ) {
    return '所要時間は30〜720分の整数で入力してください。'
  }
  return null
}

export function ReservationProductsPage() {
  const tenant = fieldTenant()
  const [products, setProducts] = useState<GolfReservationProduct[]>([])
  const [slotsByService, setSlotsByService] = useState<Record<string, EditableSlot[]>>({})
  const [slotLoadErrors, setSlotLoadErrors] = useState<Record<string, string>>({})
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [dirtyServiceIds, setDirtyServiceIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [message, setMessage] = useState<PageMessage | null>(null)

  const [productEditor, setProductEditor] = useState<ProductEditorState>(null)
  const [productDraft, setProductDraft] = useState<GolfReservationProductDraft>(emptyProductDraft)
  const [productSaving, setProductSaving] = useState(false)
  const [productError, setProductError] = useState<string | null>(null)
  const [slotSaving, setSlotSaving] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)

  const [capacityDate, setCapacityDate] = useState(todayInTokyo)
  const [capacity, setCapacity] = useState<CaddieSlotCapacity | null>(null)
  const [capacityLoading, setCapacityLoading] = useState(false)
  const [capacityError, setCapacityError] = useState<string | null>(null)

  const loadPage = useCallback(async (preferredServiceId?: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const productResponse = await courseboardApiJson<{ items: GolfReservationProduct[] }>(productsPath)
      const nextProducts = productResponse.items
      const slotResults = await Promise.all(nextProducts.map(async product => {
        try {
          const response = await courseboardApiJson<{ items: GolfProductSlot[] }>(
            slotsPath(product.reservationServiceId),
          )
          return {
            serviceId: product.reservationServiceId,
            slots: response.items.map(toEditableSlot),
            error: null,
          }
        } catch (error) {
          return {
            serviceId: product.reservationServiceId,
            slots: [] as EditableSlot[],
            error: errorMessage(error),
          }
        }
      }))

      const nextSlots: Record<string, EditableSlot[]> = {}
      const nextSlotErrors: Record<string, string> = {}
      slotResults.forEach(result => {
        nextSlots[result.serviceId] = result.slots
        if (result.error) nextSlotErrors[result.serviceId] = result.error
      })

      setProducts(nextProducts)
      setSlotsByService(nextSlots)
      setSlotLoadErrors(nextSlotErrors)
      setDirtyServiceIds([])
      setSelectedServiceId(current => {
        const requested = preferredServiceId ?? current
        if (requested && nextProducts.some(product => product.reservationServiceId === requested)) {
          return requested
        }
        return nextProducts[0]?.reservationServiceId ?? null
      })
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  const selectedProduct = useMemo(
    () => products.find(product => product.reservationServiceId === selectedServiceId) ?? null,
    [products, selectedServiceId],
  )
  const selectedSlots = selectedServiceId ? slotsByService[selectedServiceId] ?? [] : []
  const totalSlots = Object.values(slotsByService).reduce((sum, slots) => sum + slots.length, 0)
  const hasUnsavedChanges = dirtyServiceIds.length > 0

  const requestReload = useCallback(() => {
    if (
      hasUnsavedChanges
      && !window.confirm('未保存の受付枠があります。破棄して再読み込みしますか？')
    ) return
    void loadPage()
  }, [hasUnsavedChanges, loadPage])

  useRegisterPageReload(requestReload)

  function beginCreateProduct() {
    setProductDraft(emptyProductDraft())
    setProductEditor({ mode: 'create' })
    setProductError(null)
    setMessage(null)
  }

  function beginEditProduct(product: GolfReservationProduct) {
    setProductDraft(productToDraft(product))
    setProductEditor({ mode: 'edit', serviceId: product.reservationServiceId })
    setSelectedServiceId(product.reservationServiceId)
    setProductError(null)
    setSlotError(null)
    setCapacity(null)
    setCapacityError(null)
    setMessage(null)
  }

  function changePlayType(playType: PlayType) {
    setProductDraft(current => ({
      ...current,
      playType,
      expectedDurationMinutes: defaultDuration(playType, current.holeCount),
    }))
  }

  function changeHoleCount(holeCount: number) {
    setProductDraft(current => ({
      ...current,
      holeCount,
      expectedDurationMinutes: defaultDuration(current.playType, holeCount),
    }))
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!productEditor) return
    const validationError = validateProduct(productDraft)
    if (validationError) {
      setProductError(validationError)
      return
    }
    if (
      hasUnsavedChanges
      && !window.confirm('未保存の受付枠があります。先に保存せず、プレー設定を反映しますか？')
    ) return

    const serviceId = productDraft.serviceId.trim()
    setProductSaving(true)
    setProductError(null)
    setMessage(null)
    try {
      await courseboardApiJson(`${productsPath}/${encodeURIComponent(serviceId)}`, {
        method: 'POST',
        body: JSON.stringify({
          playType: productDraft.playType,
          holeCount: productDraft.holeCount,
          expectedDurationMinutes: productDraft.expectedDurationMinutes,
        }),
      })
      setProductEditor(null)
      setSelectedServiceId(serviceId)
      setMessage({
        tone: 'success',
        title: 'プレー設定を保存しました',
        body: `${serviceId} のプレー区分と所要時間を反映しました。`,
      })
      await loadPage(serviceId)
    } catch (error) {
      setProductError(errorMessage(error))
    } finally {
      setProductSaving(false)
    }
  }

  function markSlotsDirty(serviceId: string) {
    setDirtyServiceIds(current => current.includes(serviceId) ? current : [...current, serviceId])
    setSlotError(null)
    setMessage(null)
  }

  function updateSlot(clientKey: string, patch: Partial<EditableSlot>) {
    if (!selectedServiceId) return
    setSlotsByService(current => ({
      ...current,
      [selectedServiceId]: (current[selectedServiceId] ?? []).map(slot => (
        slot.clientKey === clientKey ? { ...slot, ...patch } : slot
      )),
    }))
    markSlotsDirty(selectedServiceId)
  }

  function addSlot() {
    if (!selectedServiceId) return
    const fallbackWeekday = selectedSlots.at(-1)?.weekday ?? 1
    setSlotsByService(current => ({
      ...current,
      [selectedServiceId]: [...(current[selectedServiceId] ?? []), newEditableSlot(fallbackWeekday)],
    }))
    markSlotsDirty(selectedServiceId)
  }

  function removeSlot(clientKey: string) {
    if (!selectedServiceId) return
    setSlotsByService(current => ({
      ...current,
      [selectedServiceId]: (current[selectedServiceId] ?? []).filter(slot => slot.clientKey !== clientKey),
    }))
    markSlotsDirty(selectedServiceId)
  }

  async function saveSlots() {
    if (!selectedServiceId) return
    const serviceId = selectedServiceId
    const validationErrors = validateSlots(selectedSlots)
    if (validationErrors.length > 0) {
      setSlotError(validationErrors.join('\n'))
      return
    }

    setSlotSaving(true)
    setSlotError(null)
    setMessage(null)
    try {
      const slots = selectedSlots.map(slot => ({
        weekday: slot.weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxGroups: slot.maxGroups,
        maxPlayers: slot.maxPlayers,
      }))
      await courseboardApiJson(slotsPath(serviceId), {
        method: 'PUT',
        body: JSON.stringify({ slots }),
      })
      setDirtyServiceIds(current => current.filter(id => id !== serviceId))
      setSlotLoadErrors(current => {
        const next = { ...current }
        delete next[serviceId]
        return next
      })
      setMessage({
        tone: 'success',
        title: '受付枠を保存しました',
        body: `${serviceId} の${slots.length}枠を置き換えました。`,
      })
    } catch (error) {
      setSlotError(errorMessage(error))
    } finally {
      setSlotSaving(false)
    }
  }

  async function calculateCapacity() {
    if (!capacityDate) return
    setCapacityLoading(true)
    setCapacityError(null)
    setCapacity(null)
    try {
      const query = `from=${encodeURIComponent(capacityDate)}&to=${encodeURIComponent(capacityDate)}`
      const [profilesResponse, availabilityResponse] = await Promise.all([
        courseboardApiJson<{ items: CapacityProfile[] }>(caddieProfilesPath),
        courseboardApiJson<{ items: CapacityAvailability[] }>(`${caddieAvailabilitiesPath}?${query}`),
      ])
      setCapacity(calculateCaddieCapacity(
        profilesResponse.items,
        availabilityResponse.items,
      ))
    } catch (error) {
      setCapacityError(errorMessage(error))
    } finally {
      setCapacityLoading(false)
    }
  }

  function applyCapacity() {
    if (!selectedServiceId || !capacity || !capacityDate) return
    const serviceId = selectedServiceId
    const nextSlots = applyCapacityToSlots(selectedSlots, capacityDate, capacity)
      .map(slot => 'clientKey' in slot ? slot as EditableSlot : toEditableSlot(slot))
    setSlotsByService(current => ({ ...current, [serviceId]: nextSlots }))
    markSlotsDirty(serviceId)
    setMessage({
      tone: 'info',
      title: '枠数へ反映しました',
      body: 'まだ保存されていません。時間帯を確認して「受付枠を保存」を実行してください。',
    })
  }

  const productColumns: DataTableColumn<GolfReservationProduct>[] = [
    {
      key: 'service',
      header: '予約サービス',
      mobileLabel: '予約サービス',
      cell: product => (
        <div className="grid gap-0.5">
          <strong>{product.reservationServiceId}</strong>
          <span className="text-xs text-muted-foreground">{product.id}</span>
        </div>
      ),
    },
    {
      key: 'playType',
      header: 'プレー区分',
      mobileLabel: 'プレー区分',
      cell: product => (
        <Badge variant={product.playType === 'caddie' ? 'accent' : 'neutral'}>
          {product.playType === 'caddie' ? 'キャディ付き' : 'セルフ'}
        </Badge>
      ),
    },
    {
      key: 'holes',
      header: 'ホール',
      mobileLabel: 'ホール',
      align: 'right',
      cell: product => `${product.holeCount}H`,
    },
    {
      key: 'duration',
      header: '所要時間',
      mobileLabel: '所要時間',
      align: 'right',
      cell: product => `${product.expectedDurationMinutes}分`,
    },
    {
      key: 'slots',
      header: '受付枠',
      mobileLabel: '受付枠',
      align: 'right',
      cell: product => (
        <span>
          {slotsByService[product.reservationServiceId]?.length ?? 0}枠
          {dirtyServiceIds.includes(product.reservationServiceId) ? (
            <Badge className="ml-2" variant="warning">未保存</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'updated',
      header: '更新',
      mobileLabel: '更新',
      cell: product => formatUpdatedAt(product.updatedAt),
    },
    {
      key: 'actions',
      header: <span className="sr-only">操作</span>,
      align: 'right',
      cell: product => (
        <Button
          type="button"
          size="sm"
          variant={selectedServiceId === product.reservationServiceId ? 'primary' : 'ghost'}
          onClick={() => beginEditProduct(product)}
        >
          {selectedServiceId === product.reservationServiceId ? <Check /> : <ClipboardCheck />}
          {selectedServiceId === product.reservationServiceId ? '選択中' : '編集'}
        </Button>
      ),
    },
  ]

  const slotColumns: DataTableColumn<EditableSlot>[] = [
    {
      key: 'weekday',
      header: '曜日',
      mobileLabel: '曜日',
      cell: slot => (
        <NativeSelect
          aria-label="曜日"
          value={slot.weekday}
          onChange={event => updateSlot(slot.clientKey, { weekday: Number(event.target.value) })}
        >
          {weekdayLabels.map((label, weekday) => (
            <option key={label} value={weekday}>{label}曜日</option>
          ))}
        </NativeSelect>
      ),
    },
    {
      key: 'start',
      header: '開始',
      mobileLabel: '開始',
      cell: slot => (
        <Input
          aria-label="開始時刻"
          type="time"
          value={slot.startTime}
          onChange={event => updateSlot(slot.clientKey, { startTime: event.target.value })}
        />
      ),
    },
    {
      key: 'end',
      header: '終了',
      mobileLabel: '終了',
      cell: slot => (
        <Input
          aria-label="終了時刻"
          type="time"
          value={slot.endTime}
          onChange={event => updateSlot(slot.clientKey, { endTime: event.target.value })}
        />
      ),
    },
    {
      key: 'groups',
      header: '最大組数',
      mobileLabel: '最大組数',
      align: 'right',
      cell: slot => (
        <Input
          aria-label="最大組数"
          type="number"
          min={0}
          step={1}
          value={slot.maxGroups}
          onChange={event => updateSlot(slot.clientKey, { maxGroups: Number(event.target.value) })}
        />
      ),
    },
    {
      key: 'players',
      header: '最大人数',
      mobileLabel: '最大人数',
      align: 'right',
      cell: slot => (
        <Input
          aria-label="最大人数"
          type="number"
          min={0}
          step={1}
          value={slot.maxPlayers}
          onChange={event => updateSlot(slot.clientKey, { maxPlayers: Number(event.target.value) })}
        />
      ),
    },
    {
      key: 'remove',
      header: <span className="sr-only">削除</span>,
      align: 'right',
      cell: slot => (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`${weekdayLabels[slot.weekday]}曜日 ${slot.startTime}の枠を削除`}
          onClick={() => removeSlot(slot.clientKey)}
        >
          <Trash2 /> 削除
        </Button>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader title="ゴルフ予約商品" description="プレー区分と受付枠を読み込んでいます。" />
        <LoadingState label="予約商品を読み込んでいます" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-stack">
        <PageHeader title="ゴルフ予約商品" description="プレー区分と受付枠を管理します。" />
        <ResourceError error={loadError} onRetry={() => void loadPage()} />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Golf inventory · ${tenant}`}
        title="ゴルフ予約商品"
        description="プレー区分、曜日別受付枠、キャディ供給量を管理します。既定通貨・タイムゾーンは設定画面で変更します。"
        actions={(
          <>
            <PageRefreshButton onClick={requestReload} />
            <Button type="button" variant="primary" onClick={beginCreateProduct}>
              <Plus /> 予約サービスを追加
            </Button>
          </>
        )}
      />

      <MetricGrid>
        <Metric label="予約サービス" value={products.length} detail="プレー設定済み" />
        <Metric label="受付枠" value={totalSlots} detail="全サービス合計" />
        <Metric
          label="キャディ付き"
          value={products.filter(product => product.playType === 'caddie').length}
          detail="供給量連携対象"
        />
      </MetricGrid>

      {message ? (
        <Notice tone={message.tone} title={message.title}>{message.body}</Notice>
      ) : null}

      {productEditor ? (
        <Panel
          title={productEditor.mode === 'create' ? '予約サービスを追加' : 'プレー設定を編集'}
          description="サービスIDにゴルフ固有のプレー区分、ホール数、想定所要時間を関連付けます。"
          actions={(
            <Button type="button" size="sm" variant="ghost" onClick={() => setProductEditor(null)}>
              <X /> 閉じる
            </Button>
          )}
        >
          <form className="grid gap-4" onSubmit={saveProduct}>
            <FormGrid columns={3}>
              <Field
                label="予約サービスID"
                hint={productEditor.mode === 'edit' ? '既存IDは変更できません。' : 'Fieldの予約サービスIDを入力します。'}
                required
              >
                <Input
                  value={productDraft.serviceId}
                  disabled={productEditor.mode === 'edit'}
                  onChange={event => setProductDraft(current => ({
                    ...current,
                    serviceId: event.target.value,
                  }))}
                  placeholder="golf-weekday-standard"
                  required
                  autoFocus={productEditor.mode === 'create'}
                />
              </Field>
              <Field label="プレー区分" required>
                <NativeSelect
                  value={productDraft.playType}
                  onChange={event => changePlayType(event.target.value as PlayType)}
                >
                  <option value="caddie">キャディ付き</option>
                  <option value="self">セルフ</option>
                </NativeSelect>
              </Field>
              <Field label="ホール数" required>
                <NativeSelect
                  value={productDraft.holeCount}
                  onChange={event => changeHoleCount(Number(event.target.value))}
                >
                  <option value={18}>18ホール</option>
                  <option value={9}>9ホール</option>
                </NativeSelect>
              </Field>
              <Field label="想定所要時間" hint="30〜720分" required>
                <Input
                  type="number"
                  min={30}
                  max={720}
                  step={1}
                  value={productDraft.expectedDurationMinutes}
                  onChange={event => setProductDraft(current => ({
                    ...current,
                    expectedDurationMinutes: Number(event.target.value),
                  }))}
                  required
                />
              </Field>
            </FormGrid>
            {productError ? (
              <Notice tone="danger" title="プレー設定を保存できません">{productError}</Notice>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" disabled={productSaving} onClick={() => setProductEditor(null)}>
                キャンセル
              </Button>
              <Button type="submit" variant="primary" disabled={productSaving}>
                <Save /> {productSaving ? '保存中' : 'プレー設定を保存'}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel
        title="予約サービス"
        description="行を選ぶと、そのサービスの曜日別受付枠を下で編集できます。"
        actions={<Badge variant="outline">{products.length}件</Badge>}
      >
        <DataTable
          rows={products}
          columns={productColumns}
          rowKey={product => product.id}
          onRowClick={product => {
            setSelectedServiceId(product.reservationServiceId)
            setSlotError(null)
            setCapacity(null)
            setCapacityError(null)
          }}
          empty={(
            <EmptyState
              title="ゴルフ予約サービスがありません"
              description="Fieldの予約サービスIDを登録して、プレー区分と受付枠を設定してください。"
              action={(
                <Button type="button" variant="primary" onClick={beginCreateProduct}>
                  <Plus /> 最初の予約サービスを追加
                </Button>
              )}
            />
          )}
        />
      </Panel>

      {selectedProduct ? (
        <Panel
          title={`受付枠 · ${selectedProduct.reservationServiceId}`}
          description="0は制限なしです。曜日、開始、終了が同じ行は重複登録できません。"
          actions={(
            <div className="flex items-center gap-2">
              <Badge variant={selectedProduct.playType === 'caddie' ? 'accent' : 'neutral'}>
                {selectedProduct.playType === 'caddie' ? 'キャディ付き' : 'セルフ'}
              </Badge>
              {dirtyServiceIds.includes(selectedProduct.reservationServiceId) ? (
                <Badge variant="warning">未保存</Badge>
              ) : null}
            </div>
          )}
        >
          {slotLoadErrors[selectedProduct.reservationServiceId] ? (
            <Notice tone="warning" title="既存の受付枠を読み込めませんでした">
              {slotLoadErrors[selectedProduct.reservationServiceId]}
              空のまま保存すると既存枠を置き換える可能性があります。再読み込みしてから編集してください。
            </Notice>
          ) : null}

          <DataTable
            rows={selectedSlots}
            columns={slotColumns}
            rowKey={slot => slot.clientKey}
            empty={(
              <EmptyState
                title="受付枠がありません"
                description="曜日と時間帯を追加するか、キャディ供給量から午前・午後枠を作成してください。"
                action={(
                  <Button type="button" onClick={addSlot}>
                    <Plus /> 受付枠を追加
                  </Button>
                )}
              />
            )}
          />

          {slotError ? (
            <Notice tone="danger" title="受付枠を保存できません">
              <span className="whitespace-pre-line">{slotError}</span>
            </Notice>
          ) : null}

          <div className="flex flex-wrap justify-between gap-2 pt-3">
            <Button type="button" onClick={addSlot}>
              <Plus /> 受付枠を追加
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={slotSaving || Boolean(slotLoadErrors[selectedProduct.reservationServiceId])}
              onClick={() => void saveSlots()}
            >
              <Save /> {slotSaving ? '保存中' : '受付枠を保存'}
            </Button>
          </div>
        </Panel>
      ) : null}

      {selectedProduct?.playType === 'caddie' ? (
        <Panel
          title="キャディ供給量から枠数を算出"
          description="希望休が未登録のアクティブキャディは稼働可能として計算します。結果は選択中サービスの同一曜日へ反映します。"
          actions={<Badge variant="outline"><Users /> 稼働連携</Badge>}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label="対象日" required className="w-full sm:w-44">
              <Input
                type="date"
                value={capacityDate}
                onChange={event => {
                  setCapacityDate(event.target.value)
                  setCapacity(null)
                  setCapacityError(null)
                }}
              />
            </Field>
            <Button
              type="button"
              disabled={capacityLoading || !capacityDate}
              onClick={() => void calculateCapacity()}
            >
              <Sparkles /> {capacityLoading ? '算出中' : '供給量を算出'}
            </Button>
          </div>

          {capacityError ? (
            <Notice tone="danger" title="供給量を算出できません">{capacityError}</Notice>
          ) : null}

          {capacity ? (
            <div className="grid gap-3 pt-3">
              <MetricGrid>
                <Metric label="午前" value={`${capacity.morningCapacity}組`} detail="販売上限" />
                <Metric label="午後" value={`${capacity.afternoonCapacity}組`} detail="販売上限" />
                <Metric label="担当可能" value={`${capacity.totalRounds}R`} detail="2R希望を含む" />
                <Metric
                  label="稼働キャディ"
                  value={`${capacity.activeCaddies - capacity.unavailable}/${capacity.activeCaddies}名`}
                  detail={capacity.assumedAvailable > 0
                    ? `${capacity.assumedAvailable}名は希望休未登録`
                    : '全員の希望登録済み'}
                  tone={capacity.assumedAvailable > 0 ? 'warning' : 'success'}
                />
              </MetricGrid>
              {capacity.assumedAvailable > 0 ? (
                <Notice tone="warning" title="未登録の勤務希望を含みます">
                  {capacity.assumedAvailable}名を稼働可能として計算しています。確定前にキャディ管理で希望休を確認してください。
                </Notice>
              ) : null}
              <div className="flex justify-end">
                <Button type="button" variant="primary" onClick={applyCapacity}>
                  <CalendarDays /> この曜日の枠数へ反映
                </Button>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : selectedProduct ? (
        <Notice tone="info" title="セルフプレー商品です">
          キャディ供給量の算出は不要です。曜日別の組数・人数を受付枠で直接設定してください。
        </Notice>
      ) : null}

    </div>
  )
}

export default ReservationProductsPage
