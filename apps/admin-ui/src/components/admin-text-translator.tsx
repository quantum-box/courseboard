'use client'

import { useAdminI18n } from 'lib/admin-i18n'
import { useEffect } from 'react'

const phraseTranslations = {
	en: {
		設定: 'Settings',
		更新: 'Refresh',
		再読み込み: 'Reload',
		有効: 'Enabled',
		無効: 'Disabled',
		未設定: 'Not configured',
		要修正: 'Needs changes',
		ワークスペース: 'Workspace',
		ログアウト: 'Log out',
		外部サービス連携: 'External services',
		接続されている外部サービスの状態を確認できます:
			'Review connected external service status.',
		連携設定を取得できませんでした: 'Could not load integration settings',
		'このテナントで必要な権限またはスコープが不足しています。':
			'Required permissions or scopes are missing for this tenant.',
		'Square 商品同期': 'Square product sync',
		'Square 商品同期を実行': 'Run Square product sync',
		対応範囲について: 'Scope',
		対応範囲を確認: 'Review scope',
		'ERP rolloutを確認': 'Review ERP rollout',
		このテナントのERP有効化状態と適用元を確認します:
			'Review ERP enablement status and source for this tenant.',
		アプリ: 'Apps',
		'業種別の追加機能と公開予約に連携する設定を管理します。':
			'Manage industry apps and settings linked to public reservations.',
		'業種別アプリと公開予約に連携する設定を管理します。':
			'Manage industry apps and settings linked to public reservations.',
		'TACHYON Field OS に追加する業種別アプリと、公開予約に連携する設定を管理します。':
			'Manage industry apps installed on TACHYON Field OS and settings linked to public reservations.',
		予約管理: 'Reservations',
		テナント設定: 'Tenant settings',
		ゴルフ予約商品設定: 'Golf Reservation Product Settings',
		'ゴルフ場の公開予約に出す商品、プレープラン、受付条件を設定します。':
			'Configure products, play plans, and booking rules shown on the golf reservation page.',
		有効化日時: 'Enabled at',
		無効化日時: 'Disabled at',
		設定バージョン: 'Config version',
		設定状態: 'Validation',
		標準プラン: 'Default plan',
		通常プラン: 'Standard plan',
		ライトプラン: 'Light plan',
		'1予約の最大人数': 'Max people per booking',
		追加オプション: 'Additional option',
		予約時に選択: 'Selectable at booking',
		必須: 'Required',
		提供しない: 'Not offered',
		'会員前受金率（%）': 'Member deposit ratio (%)',
		'一般前受金率（%）': 'General deposit ratio (%)',
		予約プランを保存: 'Save reservation plan',
		予約プランを無効化: 'Disable reservation plan',
		予約プランを有効化: 'Enable reservation plan',
		設定履歴: 'Settings history',
		'拡張機能設定の直近の変更履歴です。': 'Recent changes to app settings.',
		'アプリ設定の直近の変更履歴です。': 'Recent changes to app settings.',
		状態: 'status',
		操作者: 'actor',
		顧客: 'Customers',
		販売: 'Sales',
		請求: 'Billing',
		マスタ: 'Master',
		在庫: 'Inventory',
		予約: 'Reservations',
		会計: 'Accounting',
		レポート: 'Reports',
		予約設定: 'Reservation settings',
		ホーム: 'Home',
		コンシューマー: 'Consumers',
		商談: 'Deals',
		見積: 'Quotations',
		受注: 'Orders',
		店頭受取: 'Pickup',
		クーポン: 'Coupons',
		請求管理: 'Billing Center',
		請求書: 'Invoices',
		キャンセル料: 'Cancellation Fees',
		'債権・債務': 'Receivables / Payables',
		売上照合: 'Revenue Reconciliation',
		商品: 'Products',
		在庫数: 'Stock',
		低在庫: 'Low Stock',
		拠点: 'Locations',
		在庫移動: 'Transfers',
		発注: 'Purchase Orders',
		入荷OCR: 'Receiving OCR',
		仕入先: 'Vendors',
		スタッフ: 'Staff',
		ダッシュボード: 'Dashboard',
		売上台帳: 'Sales Ledger',
		仕入台帳: 'Purchase Ledger',
		仕訳レビュー: 'Journal Review',
		証憑: 'Evidence',
		月次締め: 'Monthly Close',
		監査ログ: 'Audit Logs',
		レポート一覧: 'Reports Home',
		売上分析: 'Sales Analytics',
		自動レポート: 'Automated Reports',
		ユーザー: 'Users',
		テナント: 'Tenants',
		請求アカウント: 'Billing Accounts',
		対応範囲: 'Scope',
		言語設定: 'Language',
		'管理画面の表示言語を切り替えます。':
			'Choose the display language for the admin console.',
		現在の言語: 'Current language',
		日本語: '日本語',
	},
	ja: {
		Settings: '設定',
		Refresh: '更新',
		Reload: '再読み込み',
		Enabled: '有効',
		Disabled: '無効',
		'Not configured': '未設定',
		'Needs changes': '要修正',
		Workspace: 'ワークスペース',
		'Log out': 'ログアウト',
		'Admin Console': '管理コンソール',
		'External services': '外部サービス連携',
		'Review connected external service status.':
			'接続されている外部サービスの状態を確認できます',
		'Could not load integration settings': '連携設定を取得できませんでした',
		'Square product sync': 'Square 商品同期',
		'Run Square product sync': 'Square 商品同期を実行',
		Scope: '対応範囲',
		'Review scope': '対応範囲を確認',
		'ERP rollout': 'ERP有効化',
		'Review ERP rollout': 'ERP有効化を確認',
		Apps: 'アプリ',
		'Manage industry extensions and settings linked to public reservations.':
			'業種別アプリと公開予約に連携する設定を管理します。',
		'Manage industry apps and settings linked to public reservations.':
			'業種別アプリと公開予約に連携する設定を管理します。',
		'Manage industry apps installed on TACHYON Field OS and settings linked to public reservations.':
			'TACHYON Field OS に追加する業種別アプリと、公開予約に連携する設定を管理します。',
		Reservations: '予約',
		'Tenant settings': 'テナント設定',
		'Golf Reservation Product Settings': 'ゴルフ予約商品設定',
		'Configure products, play plans, and booking rules shown on the golf reservation page.':
			'ゴルフ場の公開予約に出す商品、プレープラン、受付条件を設定します。',
		'Enabled at': '有効化日時',
		'Disabled at': '無効化日時',
		'Config version': '設定バージョン',
		Validation: '設定状態',
		'Default plan': '標準プラン',
		'Standard plan': '通常プラン',
		'Light plan': 'ライトプラン',
		'Max people per booking': '1予約の最大人数',
		'Additional option': '追加オプション',
		'Selectable at booking': '予約時に選択',
		Required: '必須',
		'Not offered': '提供しない',
		'Member deposit ratio (%)': '会員前受金率（%）',
		'General deposit ratio (%)': '一般前受金率（%）',
		'Save reservation plan': '予約プランを保存',
		'Disable reservation plan': '予約プランを無効化',
		'Enable reservation plan': '予約プランを有効化',
		'Settings history': '設定履歴',
		'Recent changes to extension settings.': 'アプリ設定の直近の変更履歴です。',
		'Recent changes to app settings.': 'アプリ設定の直近の変更履歴です。',
		status: '状態',
		actor: '操作者',
		Home: 'ホーム',
		Customers: '顧客',
		Sales: '販売',
		Billing: '請求',
		Master: 'マスタ',
		Inventory: '在庫',
		Accounting: '会計',
		Reports: 'レポート',
		'Reservation settings': '予約設定',
		Consumers: 'コンシューマー',
		Deals: '商談',
		Quotations: '見積',
		Orders: '受注',
		Pickup: '店頭受取',
		Coupons: 'クーポン',
		'Billing Center': '請求管理',
		Invoices: '請求書',
		'Cancellation Fees': 'キャンセル料',
		'Receivables / Payables': '債権・債務',
		'Revenue Reconciliation': '売上照合',
		Products: '商品',
		Stock: '在庫数',
		'Low Stock': '低在庫',
		Locations: '拠点',
		Transfers: '在庫移動',
		'Purchase Orders': '発注',
		'Receiving OCR': '入荷OCR',
		Vendors: '仕入先',
		Staff: 'スタッフ',
		Dashboard: 'ダッシュボード',
		'Sales Ledger': '売上台帳',
		'Purchase Ledger': '仕入台帳',
		'Journal Review': '仕訳レビュー',
		Evidence: '証憑',
		'Monthly Close': '月次締め',
		'Audit Logs': '監査ログ',
		'Reports Home': 'レポート一覧',
		'Sales Analytics': '売上分析',
		'Automated Reports': '自動レポート',
		Users: 'ユーザー',
		Tenants: 'テナント',
		'Billing Accounts': '請求アカウント',
		Language: '言語設定',
		'Choose the display language for the admin console.':
			'管理画面の表示言語を切り替えます。',
		'Current language': '現在の言語',
		English: 'English',
	},
} as const

function shouldSkipNode(node: Node) {
	const parent = node.parentElement
	return (
		!parent ||
		parent.closest(
			'script,style,textarea,input,select,option,[data-no-translate]',
		)
	)
}

function translateText(text: string, translations: Record<string, string>) {
	const trimmed = text.trim()
	const translated = translations[trimmed]
	if (!translated) return text
	return text.replace(trimmed, translated)
}

function translateTree(root: ParentNode, translations: Record<string, string>) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	const nodes: Text[] = []
	while (true) {
		const node = walker.nextNode()
		if (!node) break
		if (!shouldSkipNode(node) && node.textContent?.trim()) {
			nodes.push(node as Text)
		}
	}
	for (const node of nodes) {
		node.textContent = translateText(node.textContent ?? '', translations)
	}
}

export function AdminTextTranslator() {
	const { locale } = useAdminI18n()

	useEffect(() => {
		const translations = phraseTranslations[locale]
		translateTree(document.body, translations)
		const observer = new MutationObserver(mutations => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node.nodeType === Node.TEXT_NODE) {
						if (!shouldSkipNode(node)) {
							node.textContent = translateText(
								node.textContent ?? '',
								translations,
							)
						}
					} else if (node instanceof Element) {
						translateTree(node, translations)
					}
				}
			}
		})
		observer.observe(document.body, { childList: true, subtree: true })
		return () => observer.disconnect()
	}, [locale])

	return null
}
