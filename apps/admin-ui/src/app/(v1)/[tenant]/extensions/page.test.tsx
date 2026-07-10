import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdminI18nProvider } from 'lib/admin-i18n'
import { ExtensionStatusCard } from './extension-status-card'

describe('extension settings page', () => {
	it('renders config validation errors next to editable config JSON', () => {
		const html = renderToStaticMarkup(
			<AdminI18nProvider>
				<ExtensionStatusCard
					updateConfigAction='#'
					toggleAction='#'
					extension={{
						tenantId: 'tn_test',
						extensionKey: 'custom_extension',
						name: 'Custom Operations',
						industry: 'operations',
						version: '0.1.0',
						registryStatus: 'registered',
						tenantStatus: 'enabled',
						enabledAt: null,
						disabledAt: null,
						configVersion: 2,
						configJson: { defaultHoles: 27 },
						validation: {
							valid: false,
							errors: ['config.defaultHoles must be one of 9, 18'],
						},
						updatedAt: null,
					}}
				/>
			</AdminI18nProvider>,
		)

		expect(html).toContain('設定の確認事項')
		expect(html).toContain('config.defaultHoles must be one of 9, 18')
		expect(html).toContain('name="configJson"')
		expect(html).toContain('設定を保存')
	})

	it('renders restaurant extension settings as editable tenant config', () => {
		const html = renderToStaticMarkup(
			<AdminI18nProvider>
				<ExtensionStatusCard
					updateConfigAction='#'
					toggleAction='#'
					extension={{
						tenantId: 'tn_restaurant',
						extensionKey: 'restaurant_table',
						name: 'Restaurant Table Reservations',
						industry: 'restaurant',
						version: '0.1.0',
						registryStatus: 'registered',
						tenantStatus: 'disabled',
						enabledAt: null,
						disabledAt: null,
						configVersion: 1,
						configJson: {
							seatingAreas: ['counter', 'table'],
							smokingPolicy: 'non_smoking_only',
							defaultPartySize: 2,
							maxPartySize: 8,
						},
						validation: {
							valid: true,
							errors: [],
						},
						updatedAt: null,
					}}
				/>
			</AdminI18nProvider>,
		)

		expect(html).toContain('Restaurant Table Reservations')
		expect(html).toContain('restaurant_table / restaurant / v0.1.0')
		expect(html).toContain('name="configJson"')
		expect(html).toContain('&quot;seatingAreas&quot;')
		expect(html).toContain('有効化')
	})

	it('renders application intake extension settings without requiring JSON editing', () => {
		const html = renderToStaticMarkup(
			<AdminI18nProvider>
				<ExtensionStatusCard
					updateConfigAction='#'
					toggleAction='#'
					extension={{
						tenantId: 'tn_dog_run',
						extensionKey: 'dog_run',
						name: 'Dog Run Intake',
						industry: 'restaurant',
						version: '0.1.0',
						registryStatus: 'registered',
						tenantStatus: 'enabled',
						enabledAt: null,
						disabledAt: null,
						configVersion: 1,
						configJson: {
							formPresentation: {
								publicTitle: 'ドッグラン利用申込',
								publicDescription: '公開説明',
								kioskTitle: 'ドッグラン利用受付',
								kioskDescription: 'iPad説明',
								submitLabel: '申込して決済へ進む',
								disabledTitle: '受付停止中',
								disabledDescription: 'スタッフへお声がけください',
								badgeLabel: 'Dog Run',
							},
							courses: [
								{
									code: 'day',
									label: '1日利用コース',
									startTime: '10:00',
									endTime: '15:00',
									pricesByDogCount: { '1': 1600, '2': 2600 },
									currency: 'JPY',
								},
							],
							consentItems: [
								{
									key: 'termsConfirmed',
									label: '利用条件を確認しました。',
									required: true,
								},
							],
							subjectGroups: [
								{
									key: 'dogs',
									label: '愛犬情報',
									singularLabel: '愛犬',
									countLabel: '頭数',
									maxCount: 2,
									certificateLabel: '証明書確認済み',
									fields: [],
								},
							],
							configEditorSpec: {
								root: 'editor',
								elements: {
									editor: {
										type: 'Stack',
										props: {},
										children: [
											'presentation',
											'courses',
											'subjects',
											'consents',
											'advanced',
										],
									},
									presentation: {
										type: 'ApplicationPresentationEditor',
										props: {},
										children: [],
									},
									courses: {
										type: 'ApplicationCoursesEditor',
										props: { maxCourses: 4 },
										children: [],
									},
									subjects: {
										type: 'ApplicationSubjectGroupEditor',
										props: {},
										children: [],
									},
									consents: {
										type: 'ApplicationConsentItemsEditor',
										props: { maxItems: 8 },
										children: [],
									},
									advanced: {
										type: 'AdvancedJsonDetails',
										props: { summary: '詳細 JSON' },
										children: [],
									},
								},
							},
						},
						validation: {
							valid: true,
							errors: [],
						},
						updatedAt: null,
					}}
				/>
			</AdminI18nProvider>,
		)

		expect(html).toContain('受付画面の表示')
		expect(html).toContain('name="presentation_publicTitle"')
		expect(html).toContain('name="course_0_price_1"')
		expect(html).toContain('name="consent_0_label"')
		expect(html).toContain('詳細 JSON')
		expect(html).toContain('readOnly=""')
	})
})
