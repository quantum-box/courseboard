import { Button, Input } from '@tachyon-sdk/native-ui'
import { Eye, Pencil, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Field, NativeTextarea, resourceErrorText } from '../../../../components/Page'
import { showToast } from '../../../../lib/toast'
import {
  deactivateReceptionConsentItem,
  updateReceptionConsentItem,
  type ReceptionConsentItemUpdate,
} from './api'
import type { ReceptionConsentItem } from './models'

type Draft = { label: string; body: string; required: boolean }

/**
 * Field consent items registered for this tenant, with edit and delete.
 *
 * Delete is a deactivation: Field keeps the definition so recorded consents
 * still point at the wording the visitor signed, and it can be shown again.
 */
export function ConsentItemList({
  items,
  disabled = false,
  onChanged,
}: {
  items: readonly ReceptionConsentItem[]
  disabled?: boolean
  onChanged?: (item: ReceptionConsentItem) => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ label: '', body: '', required: false })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const inactiveCount = items.filter(item => !item.active).length
  const visible = showInactive ? items : items.filter(item => item.active)
  const locked = disabled || busyId !== null

  function startEdit(item: ReceptionConsentItem) {
    setEditingId(item.id)
    setDraft({ label: item.label, body: item.body ?? '', required: item.required })
  }

  async function send(
    item: ReceptionConsentItem,
    update: ReceptionConsentItemUpdate,
    success: string,
    failure: string,
  ) {
    if (!item.id) return
    setBusyId(item.id)
    try {
      const updated = await updateReceptionConsentItem(item.id, update)
      onChanged?.(updated)
      setEditingId(null)
      showToast({ tone: 'success', message: success })
    } catch (error) {
      showToast({ tone: 'danger', title: failure, message: resourceErrorText(error) })
    } finally {
      setBusyId(null)
    }
  }

  async function remove(item: ReceptionConsentItem) {
    if (!item.id) return
    if (!window.confirm(t('customers:reception.settings.consentDeleteConfirm', { label: item.label }))) {
      return
    }
    setBusyId(item.id)
    try {
      await deactivateReceptionConsentItem(item.id)
      onChanged?.({ ...item, active: false })
      showToast({ tone: 'success', message: t('customers:reception.settings.consentDeleted') })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('customers:reception.settings.consentDeleteFailed'),
        message: resourceErrorText(error),
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      {visible.length > 0 ? (
        <ul className="reception-consent-candidate-list">
          {visible.map(item => (
            <li key={item.consentKey} className="reception-consent-item">
              {editingId === item.id ? (
                <form
                  className="reception-consent-edit"
                  onSubmit={event => {
                    event.preventDefault()
                    void send(
                      item,
                      {
                        label: draft.label,
                        body: draft.body.trim() ? draft.body : null,
                        required: draft.required,
                      },
                      t('customers:reception.settings.consentSaved'),
                      t('customers:reception.settings.consentSaveFailed'),
                    )
                  }}
                >
                  <Field label={t('customers:reception.settings.consentLabelField')} required>
                    <Input
                      value={draft.label}
                      disabled={locked}
                      onChange={event => setDraft({ ...draft, label: event.target.value })}
                    />
                  </Field>
                  <Field label={t('customers:reception.settings.consentBodyField')}>
                    <NativeTextarea
                      value={draft.body}
                      disabled={locked}
                      onChange={event => setDraft({ ...draft, body: event.target.value })}
                    />
                  </Field>
                  <label className="reception-custom-field-check">
                    <input
                      type="checkbox"
                      checked={draft.required}
                      disabled={locked}
                      onChange={event => setDraft({ ...draft, required: event.target.checked })}
                    />
                    {t('customers:reception.consents.required')}
                  </label>
                  <p className="reception-settings-hint">
                    {t('customers:reception.settings.consentVersionNote')}
                  </p>
                  <div className="reception-consent-item-actions">
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={locked || !draft.label.trim()}
                    >
                      <Save />
                      {t('customers:reception.settings.consentSave')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={locked}
                      onClick={() => setEditingId(null)}
                    >
                      <X />
                      {t('customers:reception.settings.consentCancel')}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="reception-consent-item-text">
                    <strong>{item.label}</strong>
                    <small>
                      {item.consentKey}
                      {item.required ? ` / ${t('customers:reception.consents.required')}` : ''}
                      {' / '}
                      {t('customers:reception.settings.consentTermsVersion', { version: item.termsVersion })}
                      {' / '}
                      {item.active
                        ? t('customers:reception.settings.consentItemRegistered')
                        : t('customers:reception.settings.consentItemInactive')}
                    </small>
                    {item.body ? <span>{item.body}</span> : null}
                  </div>
                  <div className="reception-consent-item-actions">
                    {item.active ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={locked || !item.id}
                          aria-label={t('customers:reception.settings.consentEditLabel', { label: item.label })}
                          onClick={() => startEdit(item)}
                        >
                          <Pencil />
                          {t('customers:reception.settings.consentEdit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={locked || !item.id}
                          aria-label={t('customers:reception.settings.consentDeleteLabel', { label: item.label })}
                          onClick={() => void remove(item)}
                        >
                          <Trash2 />
                          {t('customers:reception.settings.consentDelete')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={locked || !item.id}
                        aria-label={t('customers:reception.settings.consentRestoreLabel', { label: item.label })}
                        onClick={() => void send(
                          item,
                          { active: true },
                          t('customers:reception.settings.consentRestored'),
                          t('customers:reception.settings.consentSaveFailed'),
                        )}
                      >
                        <Eye />
                        {t('customers:reception.settings.consentRestore')}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="reception-settings-empty" role="status">
          {t('customers:reception.settings.consentRegisteredEmpty')}
        </p>
      )}
      {inactiveCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowInactive(current => !current)}
        >
          {showInactive
            ? t('customers:reception.settings.consentHideInactive')
            : t('customers:reception.settings.consentShowInactive', { count: inactiveCount })}
        </Button>
      ) : null}
    </>
  )
}
