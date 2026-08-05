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
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { today } from '../../lib/clock'
import { i18next } from '../../i18n'
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
  PageRefreshButton,
  Panel,
  ResourceError,
  resourceErrorText,
  type DataTableColumn,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import {
  applyCapacityToSlots,
  calculateCaddieCapacity,
  defaultDuration,
  emptyProductDraft,
  emptySlot,
  normalizeSlot,
  productToDraft,
  validateSlots,
  weekdayIndexes,
  weekdayLabel,
  type CapacityAvailability,
  type CapacityProfile,
  type CaddieSlotCapacity,
  type GolfProductSlot,
  type GolfReservationProduct,
  type GolfReservationProductDraft,
  type PlayType,
  validateProduct,
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

/**
 * Save failures land in one-line notices, which used to print the server's own
 * English. Route them through the shared mapping so the sentence the operator
 * reads first follows the active locale.
 */
function errorMessage(error: unknown) {
  return error instanceof Error ? resourceErrorText(error) : i18next.t('products:error.generic')
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



function productDisplayName(product: GolfReservationProduct) {
  return product.displayName?.trim() || product.reservationServiceId
}

export function ReservationProductsPage() {
  const { t } = useTranslation(['products', 'common', 'courses'])
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

  const [capacityDate, setCapacityDate] = useState(today)
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
  const hasUnsavedChanges = dirtyServiceIds.length > 0

  const requestReload = useCallback(() => {
    if (
      hasUnsavedChanges
      && !window.confirm(i18next.t('products:confirm.discardOnReload'))
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
      && !window.confirm(t('products:confirm.discardOnSave'))
    ) return

    const serviceId = productDraft.serviceId.trim()
    setProductSaving(true)
    setProductError(null)
    setMessage(null)
    try {
      await courseboardApiJson(`${productsPath}/${encodeURIComponent(serviceId)}`, {
        method: 'POST',
        body: JSON.stringify({
          displayName: productDraft.displayName.trim(),
          playType: productDraft.playType,
          holeCount: productDraft.holeCount,
          expectedDurationMinutes: productDraft.expectedDurationMinutes,
        }),
      })
      setProductEditor(null)
      setSelectedServiceId(serviceId)
      setMessage({
        tone: 'success',
        title: t('products:editor.saved.title'),
        body: t('products:editor.saved.body', {
          name: productDraft.displayName.trim(),
          serviceId,
        }),
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
        title: t('products:slots.saved.title'),
        body: t('products:slots.saved.body', { serviceId, n: String(slots.length) }),
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
      title: t('products:capacity.applied.title'),
      body: t('products:capacity.applied.body'),
    })
  }

  const productColumns: DataTableColumn<GolfReservationProduct>[] = [
    {
      key: 'service',
      header: t('products:list.table.service'),
      mobileLabel: t('products:list.table.service'),
      cell: product => (
        <div className="grid gap-0.5">
          <strong>{productDisplayName(product)}</strong>
          <span className="text-xs text-muted-foreground">
            {t('products:slots.subtitle', { serviceId: product.reservationServiceId })}
          </span>
        </div>
      ),
    },
    {
      key: 'playType',
      header: t('products:list.table.playType'),
      mobileLabel: t('products:list.table.playType'),
      cell: product => (
        <Badge variant={product.playType === 'caddie' ? 'accent' : 'neutral'}>
          {product.playType === 'caddie' ? t('products:playType.caddie') : t('products:playType.self')}
        </Badge>
      ),
    },
    {
      key: 'holes',
      header: t('products:list.table.holes'),
      mobileLabel: t('products:list.table.holes'),
      align: 'right',
      cell: product => `${product.holeCount}H`,
    },
    {
      key: 'duration',
      header: t('products:list.table.duration'),
      mobileLabel: t('products:list.table.duration'),
      align: 'right',
      cell: product => t('common:unit.minutes', { n: String(product.expectedDurationMinutes) }),
    },
    {
      key: 'slots',
      header: t('products:list.table.slots'),
      mobileLabel: t('products:list.table.slots'),
      align: 'right',
      cell: product => (
        <span>
          {t('products:list.table.slotCount', {
            n: String(slotsByService[product.reservationServiceId]?.length ?? 0),
          })}
          {dirtyServiceIds.includes(product.reservationServiceId) ? (
            <Badge className="ml-2" variant="warning">{t('products:list.table.unsaved')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'updated',
      header: t('products:list.table.updated'),
      mobileLabel: t('products:list.table.updated'),
      cell: product => formatUpdatedAt(product.updatedAt),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('products:list.table.actions')}</span>,
      align: 'right',
      cell: product => (
        <Button
          type="button"
          size="sm"
          variant={selectedServiceId === product.reservationServiceId ? 'primary' : 'ghost'}
          onClick={() => beginEditProduct(product)}
        >
          {selectedServiceId === product.reservationServiceId ? <Check /> : <ClipboardCheck />}
          {selectedServiceId === product.reservationServiceId
            ? t('products:list.selected')
            : t('common:action.edit')}
        </Button>
      ),
    },
  ]

  const slotColumns: DataTableColumn<EditableSlot>[] = [
    {
      key: 'weekday',
      header: t('products:slots.table.weekday'),
      mobileLabel: t('products:slots.table.weekday'),
      cell: slot => (
        <NativeSelect
          aria-label={t('products:slots.table.weekday')}
          value={slot.weekday}
          onChange={event => updateSlot(slot.clientKey, { weekday: Number(event.target.value) })}
        >
          {weekdayIndexes.map(weekday => (
            <option key={weekday} value={weekday}>
              {t('products:slots.table.weekdaySuffix', { day: weekdayLabel(weekday) })}
            </option>
          ))}
        </NativeSelect>
      ),
    },
    {
      key: 'start',
      header: t('products:slots.table.start'),
      mobileLabel: t('products:slots.table.start'),
      cell: slot => (
        <Input
          aria-label={t('products:slots.table.start')}
          type="time"
          value={slot.startTime}
          onChange={event => updateSlot(slot.clientKey, { startTime: event.target.value })}
        />
      ),
    },
    {
      key: 'end',
      header: t('products:slots.table.end'),
      mobileLabel: t('products:slots.table.end'),
      cell: slot => (
        <Input
          aria-label={t('products:slots.table.end')}
          type="time"
          value={slot.endTime}
          onChange={event => updateSlot(slot.clientKey, { endTime: event.target.value })}
        />
      ),
    },
    {
      key: 'groups',
      header: t('products:slots.table.maxGroups'),
      mobileLabel: t('products:slots.table.maxGroups'),
      align: 'right',
      cell: slot => (
        <Input
          aria-label={t('products:slots.table.maxGroups')}
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
      header: t('products:slots.table.maxPlayers'),
      mobileLabel: t('products:slots.table.maxPlayers'),
      align: 'right',
      cell: slot => (
        <Input
          aria-label={t('products:slots.table.maxPlayers')}
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
      header: <span className="sr-only">{t('products:slots.table.delete')}</span>,
      align: 'right',
      cell: slot => (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t('products:slots.table.deleteAria', {
            day: weekdayLabel(slot.weekday),
            time: slot.startTime,
          })}
          onClick={() => removeSlot(slot.clientKey)}
        >
          <Trash2 /> {t('common:action.delete')}
        </Button>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingState label={t('products:loading')} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-stack">
        <ResourceError error={loadError} onRetry={() => void loadPage()} />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <PageRefreshButton onClick={requestReload} />
        <Button type="button" variant="primary" onClick={beginCreateProduct}>
          <Plus /> {t('products:addService')}
        </Button>
      </div>

      {message ? (
        <Notice tone={message.tone} title={message.title}>{message.body}</Notice>
      ) : null}

      <Sheet
        open={Boolean(productEditor)}
        onOpenChange={open => {
          if (!open) setProductEditor(null)
        }}
        title={productEditor?.mode === 'edit'
          ? t('products:editor.editTitle')
          : t('products:editor.createTitle')}
        description={t('products:editor.description')}
      >
        <form className="grid gap-4" onSubmit={saveProduct}>
          <FormGrid columns={1}>
            <Field
              label={t('products:editor.displayName')}
              hint={t('products:editor.displayNameHint')}
              required
            >
              <Input
                value={productDraft.displayName}
                maxLength={255}
                onChange={event => setProductDraft(current => ({
                  ...current,
                  displayName: event.target.value,
                }))}
                placeholder={t('products:editor.displayNamePlaceholder')}
                required
                autoFocus={productEditor?.mode === 'create'}
              />
            </Field>
            <Field
              label={t('products:editor.serviceId')}
              hint={productEditor?.mode === 'edit'
                ? t('products:editor.serviceIdHintEdit')
                : t('products:editor.serviceIdHintNew')}
              required
            >
              <Input
                value={productDraft.serviceId}
                disabled={productEditor?.mode === 'edit'}
                onChange={event => setProductDraft(current => ({
                  ...current,
                  serviceId: event.target.value,
                }))}
                placeholder="golf-weekday-standard"
                required
              />
            </Field>
            <Field label={t('products:editor.playType')} required>
              <NativeSelect
                value={productDraft.playType}
                onChange={event => changePlayType(event.target.value as PlayType)}
              >
                <option value="caddie">{t('products:playType.caddie')}</option>
                <option value="self">{t('products:playType.self')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('products:editor.holeCount')} required>
              <NativeSelect
                value={productDraft.holeCount}
                onChange={event => changeHoleCount(Number(event.target.value))}
              >
                <option value={18}>{t('courses:option.holes18')}</option>
                <option value={9}>{t('courses:option.holes9')}</option>
              </NativeSelect>
            </Field>
            <Field
              label={t('products:editor.duration')}
              hint={t('products:editor.durationHint')}
              required
            >
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
            <Notice tone="danger" title={t('products:editor.saveFailed')}>{productError}</Notice>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" disabled={productSaving} onClick={() => setProductEditor(null)}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={productSaving}>
              <Save /> {productSaving ? t('common:action.saving') : t('products:editor.save')}
            </Button>
          </div>
        </form>
      </Sheet>

      <Panel
        title={t('products:list.title')}
        description={t('products:list.description')}
        actions={<Badge variant="outline">{t('products:list.badge', { n: String(products.length) })}</Badge>}
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
              title={t('products:list.empty.title')}
              description={t('products:list.empty.description')}
              action={(
                <Button type="button" variant="primary" onClick={beginCreateProduct}>
                  <Plus /> {t('products:list.empty.action')}
                </Button>
              )}
            />
          )}
        />
      </Panel>

      {selectedProduct ? (
        <Panel
          title={t('products:slots.title', { name: productDisplayName(selectedProduct) })}
          description={`${t('products:slots.subtitle', {
            serviceId: selectedProduct.reservationServiceId,
          })} · ${t('products:slots.description')}`}
          actions={(
            <div className="flex items-center gap-2">
              <Badge variant={selectedProduct.playType === 'caddie' ? 'accent' : 'neutral'}>
                {selectedProduct.playType === 'caddie'
                  ? t('products:playType.caddie')
                  : t('products:playType.self')}
              </Badge>
              {dirtyServiceIds.includes(selectedProduct.reservationServiceId) ? (
                <Badge variant="warning">{t('products:list.table.unsaved')}</Badge>
              ) : null}
            </div>
          )}
        >
          {slotLoadErrors[selectedProduct.reservationServiceId] ? (
            <Notice tone="warning" title={t('products:slots.loadFailed.title')}>
              {slotLoadErrors[selectedProduct.reservationServiceId]}
              {t('products:slots.loadFailed.description')}
            </Notice>
          ) : null}

          <DataTable
            rows={selectedSlots}
            columns={slotColumns}
            rowKey={slot => slot.clientKey}
            empty={(
              <EmptyState
                title={t('products:slots.empty.title')}
                description={t('products:slots.empty.description')}
                action={(
                  <Button type="button" onClick={addSlot}>
                    <Plus /> {t('products:slots.add')}
                  </Button>
                )}
              />
            )}
          />

          {slotError ? (
            <Notice tone="danger" title={t('products:slots.saveFailed')}>
              <span className="whitespace-pre-line">{slotError}</span>
            </Notice>
          ) : null}

          <div className="flex flex-wrap justify-between gap-2 pt-3">
            <Button type="button" onClick={addSlot}>
              <Plus /> {t('products:slots.add')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={slotSaving || Boolean(slotLoadErrors[selectedProduct.reservationServiceId])}
              onClick={() => void saveSlots()}
            >
              <Save /> {slotSaving ? t('common:action.saving') : t('products:slots.save')}
            </Button>
          </div>
        </Panel>
      ) : null}

      {selectedProduct?.playType === 'caddie' ? (
        <Panel
          title={t('products:capacity.title')}
          description={t('products:capacity.description')}
          actions={<Badge variant="outline"><Users /> {t('products:capacity.badge')}</Badge>}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field requirement="none" label={t('products:capacity.date')} className="w-full sm:w-44">
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
              <Sparkles />
              {capacityLoading ? t('products:capacity.calculating') : t('products:capacity.calculate')}
            </Button>
          </div>

          {capacityError ? (
            <Notice tone="danger" title={t('products:capacity.failed')}>{capacityError}</Notice>
          ) : null}

          {capacity ? (
            <div className="grid gap-3 pt-3">
              <MetricGrid>
                <Metric
                  label={t('products:capacity.morning')}
                  value={t('products:capacity.groups', { n: String(capacity.morningCapacity) })}
                  detail={t('products:capacity.limit')}
                />
                <Metric
                  label={t('products:capacity.afternoon')}
                  value={t('products:capacity.groups', { n: String(capacity.afternoonCapacity) })}
                  detail={t('products:capacity.limit')}
                />
                <Metric
                  label={t('products:capacity.rounds')}
                  value={t('products:capacity.roundsValue', { n: String(capacity.totalRounds) })}
                  detail={t('products:capacity.roundsDetail')}
                />
                <Metric
                  label={t('products:capacity.activeCaddies')}
                  value={t('products:capacity.activeCaddiesValue', {
                    available: String(capacity.activeCaddies - capacity.unavailable),
                    total: String(capacity.activeCaddies),
                  })}
                  detail={capacity.assumedAvailable > 0
                    ? t('products:capacity.assumed', { n: String(capacity.assumedAvailable) })
                    : t('products:capacity.allRegistered')}
                  tone={capacity.assumedAvailable > 0 ? 'warning' : 'success'}
                />
              </MetricGrid>
              {capacity.assumedAvailable > 0 ? (
                <Notice tone="warning" title={t('products:capacity.warning.title')}>
                  {t('products:capacity.warning.description', {
                    n: String(capacity.assumedAvailable),
                  })}
                </Notice>
              ) : null}
              <div className="flex justify-end">
                <Button type="button" variant="primary" onClick={applyCapacity}>
                  <CalendarDays /> {t('products:capacity.apply')}
                </Button>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : selectedProduct ? (
        <Notice tone="info" title={t('products:capacity.selfNotice.title')}>
          {t('products:capacity.selfNotice.description')}
        </Notice>
      ) : null}

    </div>
  )
}

export default ReservationProductsPage
