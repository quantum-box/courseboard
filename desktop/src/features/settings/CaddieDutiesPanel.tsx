import { Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../api'
import { Field, LoadingState, Notice, Panel, ResourceError } from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { showToast } from '../../lib/toast'
import {
  MAX_CADDIE_DUTIES,
  MAX_CADDIE_DUTY_LENGTH,
  normalizedCaddieDuties,
  validateCaddieDuties,
} from '../golf/caddieDuties'

const caddieDutiesPath = '/v1/course/caddie-duties'

/**
 * The jobs this club fills when a caddie has no round.
 *
 * A pick list rather than a free text box on the dispatch screen: a job typed
 * once at the desk is one nothing else can group, count, or find again. The
 * days already filed keep the name they were filed under, so retiring a job
 * here never rewrites what last week says a caddie did.
 */
export function CaddieDutiesPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const resource = useResource(
    () => courseboardApiJson<{ items: string[] }>(caddieDutiesPath),
    [],
    { cacheKey: 'course:caddie-duties' },
  )
  const [draft, setDraft] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  // The saved list becomes the draft once it arrives; edits stay local until
  // the operator saves, so a half-arranged list never reaches the desk.
  useEffect(() => {
    if (resource.data) setDraft(resource.data.items)
  }, [resource.data])

  const duties = draft ?? []
  const problem = validateCaddieDuties(duties)

  const update = (index: number, value: string) => {
    setDraft(duties.map((duty, position) => (position === index ? value : duty)))
  }

  const save = async () => {
    if (problem) return
    setSaving(true)
    try {
      await courseboardApiJson<{ items: string[] }>(caddieDutiesPath, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: normalizedCaddieDuties(duties) }),
      })
      showToast({ tone: 'success', message: t('settings:caddieDuties.saved') })
      await resource.refresh()
    } catch (saveError) {
      showToast({
        tone: 'danger',
        title: t('settings:caddieDuties.failed'),
        message: saveError instanceof Error ? saveError.message : String(saveError),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title={t('settings:caddieDuties.title')}
      description={t('settings:caddieDuties.description')}
      actions={
        <Button type="button" onClick={() => void save()} disabled={saving || problem !== null}>
          {t('common:action.save')}
        </Button>
      }
    >
      {resource.loading ? <LoadingState /> : null}
      {resource.error ? (
        <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
      ) : null}

      {draft ? (
        <>
          {problem === 'duplicate' ? (
            <Notice tone="danger">{t('settings:caddieDuties.duplicate')}</Notice>
          ) : null}
          {problem === 'tooLong' ? (
            <Notice tone="danger">
              {t('settings:caddieDuties.tooLong', { max: String(MAX_CADDIE_DUTY_LENGTH) })}
            </Notice>
          ) : null}
          {problem === 'tooMany' ? (
            <Notice tone="danger">
              {t('settings:caddieDuties.tooMany', { max: String(MAX_CADDIE_DUTIES) })}
            </Notice>
          ) : null}

          <ul className="settings-rows">
            {duties.map((duty, index) => (
              // Index-keyed on purpose: rows are positional here, and keying by
              // the name would remount every row as the operator types one.
              // eslint-disable-next-line react/no-array-index-key
              <li className="settings-rows__row caddie-duty-row" key={index}>
                <span className="settings-rows__rank">{index + 1}</span>
                <Field label={t('settings:caddieDuties.field.label')}>
                  <Input
                    value={duty}
                    onChange={event => update(index, event.target.value)}
                    placeholder={t('settings:caddieDuties.placeholder')}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('settings:caddieDuties.remove')}
                  onClick={() => setDraft(duties.filter((_, position) => position !== index))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>

          {duties.length === 0 ? (
            <Notice tone="info">{t('settings:caddieDuties.empty')}</Notice>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={duties.length >= MAX_CADDIE_DUTIES}
            onClick={() => setDraft([...duties, ''])}
          >
            <Plus />
            {t('settings:caddieDuties.add')}
          </Button>
        </>
      ) : null}
    </Panel>
  )
}
