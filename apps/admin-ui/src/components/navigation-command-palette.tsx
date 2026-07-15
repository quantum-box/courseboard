'use client'

import { Button } from 'components/ui/button'
import { announceRouteNavigationStart } from 'components/route-progress-bar'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import {
	buildHref,
	buildMenuItemHref,
	dashboardItem,
	isAdminRole,
	menuGroups,
	workspaceSettingsItems,
	type IconComponent,
} from 'components/side-menu'
import { useAdminI18n } from 'lib/admin-i18n'
import { cn } from 'lib/utils'
import { CornerDownLeftIcon, SearchIcon } from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

type NavigationCommand = {
	externalDocument: boolean
	groupLabel: string
	href: string
	icon: IconComponent
	keywords: string
	label: string
	path: string
}

function normalizeQuery(value: string) {
	return value.trim().toLowerCase()
}

export function NavigationCommandPalette({
	buttonClassName,
	labelAlwaysVisible = false,
	modePrefix,
	tenantId,
	userRole,
}: {
	buttonClassName?: string
	labelAlwaysVisible?: boolean
	modePrefix: string
	tenantId: string
	userRole?: string | null
}) {
	const { t } = useAdminI18n()
	const router = useRouter()
	const inputRef = useRef<HTMLInputElement>(null)
	const [isOpen, setIsOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [selectedIndex, setSelectedIndex] = useState(0)

	const commands = useMemo<NavigationCommand[]>(() => {
		const entries: NavigationCommand[] = [
			{
				externalDocument: false,
				groupLabel: t('nav.global'),
				href: buildHref(modePrefix, tenantId, dashboardItem.path),
				icon: dashboardItem.icon,
				keywords: `${t(dashboardItem.labelKey)} ${dashboardItem.path}`,
				label: t(dashboardItem.labelKey),
				path: dashboardItem.path,
			},
		]

		for (const group of menuGroups) {
			const groupLabel = t(group.labelKey)
			for (const item of group.items) {
				if (item.adminOnly && !isAdminRole(userRole)) {
					continue
				}
				const label = t(item.labelKey)
				entries.push({
					externalDocument: Boolean(item.courseboardRoute),
					groupLabel,
					href: buildMenuItemHref(modePrefix, tenantId, item),
					icon: item.icon,
					keywords: `${label} ${groupLabel} ${item.path}`,
					label,
					path: item.path,
				})
			}
		}

		const settingsGroupLabel = t('nav.settings')
		for (const item of workspaceSettingsItems) {
			if (item.adminOnly && !isAdminRole(userRole)) {
				continue
			}
			const label = t(item.labelKey)
			entries.push({
				externalDocument: false,
				groupLabel: settingsGroupLabel,
				href: buildHref(modePrefix, tenantId, item.path),
				icon: item.icon,
				keywords: `${label} ${settingsGroupLabel} ${item.path}`,
				label,
				path: item.path,
			})
		}

		return entries
	}, [modePrefix, tenantId, t, userRole])

	const filteredCommands = useMemo(() => {
		const normalizedQuery = normalizeQuery(query)
		if (!normalizedQuery) {
			return commands
		}

		return commands.filter(command =>
			command.keywords.toLowerCase().includes(normalizedQuery),
		)
	}, [commands, query])

	useEffect(() => {
		const openFromShortcut = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault()
				setIsOpen(true)
			}
		}

		window.addEventListener('keydown', openFromShortcut)
		return () => window.removeEventListener('keydown', openFromShortcut)
	}, [])

	useEffect(() => {
		if (!isOpen) {
			setQuery('')
			return
		}

		window.requestAnimationFrame(() => inputRef.current?.focus())
	}, [isOpen])

	useEffect(() => {
		setSelectedIndex(0)
	}, [query])

	useEffect(() => {
		if (selectedIndex >= filteredCommands.length) {
			setSelectedIndex(Math.max(filteredCommands.length - 1, 0))
		}
	}, [filteredCommands.length, selectedIndex])

	const navigateTo = (command: NavigationCommand | undefined) => {
		if (!command) {
			return
		}

		setIsOpen(false)
		announceRouteNavigationStart()
		if (command.externalDocument) {
			window.location.assign(command.href)
			return
		}
		router.push(command.href as Route)
	}

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setSelectedIndex(index =>
				Math.min(index + 1, Math.max(filteredCommands.length - 1, 0)),
			)
			return
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault()
			setSelectedIndex(index => Math.max(index - 1, 0))
			return
		}

		if (event.key === 'Enter') {
			event.preventDefault()
			navigateTo(filteredCommands[selectedIndex])
		}
	}

	return (
		<>
			<Button
				aria-label='遷移を検索'
				className={cn(
					'h-9 gap-2 px-2.5 text-muted-foreground',
					buttonClassName,
				)}
				onClick={() => setIsOpen(true)}
				type='button'
				variant='outline'
			>
				<SearchIcon className='h-4 w-4' />
				<span
					className={cn(
						'text-sm',
						labelAlwaysVisible ? '' : 'hidden sm:inline',
					)}
				>
					検索
				</span>
				<kbd
					className={cn(
						'rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground',
						labelAlwaysVisible ? 'ml-auto' : 'ml-1 hidden sm:inline',
					)}
				>
					⌘K
				</kbd>
			</Button>

			<Dialog open={isOpen} onOpenChange={setIsOpen}>
				<DialogContent className='top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0'>
					<div className='border-b px-4 py-3'>
						<DialogTitle className='sr-only'>遷移を検索</DialogTitle>
						<DialogDescription className='sr-only'>
							管理画面のページを検索して移動します
						</DialogDescription>
						<div className='flex items-center gap-2'>
							<SearchIcon className='h-4 w-4 shrink-0 text-muted-foreground' />
							<Input
								ref={inputRef}
								aria-label='遷移を検索'
								className='h-9 border-0 px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0'
								onChange={event => setQuery(event.target.value)}
								onKeyDown={handleKeyDown}
								placeholder='ページを検索'
								value={query}
							/>
						</div>
					</div>
					<div
						className='max-h-[min(480px,60vh)] overflow-y-auto p-2'
						role='listbox'
						tabIndex={-1}
					>
						{filteredCommands.length > 0 ? (
							filteredCommands.map((command, index) => {
								const Icon = command.icon
								const isSelected = index === selectedIndex
								return (
									<button
										key={`${command.href}-${index}`}
										aria-selected={isSelected}
										className={cn(
											'flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
											isSelected
												? 'bg-foreground text-background'
												: 'text-foreground hover:bg-muted',
										)}
										onClick={() => navigateTo(command)}
										onMouseEnter={() => setSelectedIndex(index)}
										role='option'
										type='button'
									>
										<Icon
											className={cn(
												'h-4 w-4 shrink-0',
												isSelected
													? 'text-background'
													: 'text-muted-foreground',
											)}
										/>
										<span className='min-w-0 flex-1'>
											<span className='block truncate text-sm font-medium'>
												{command.label}
											</span>
											<span
												className={cn(
													'block truncate text-xs',
													isSelected
														? 'text-background/70'
														: 'text-muted-foreground',
												)}
											>
												{command.groupLabel} · {command.path}
											</span>
										</span>
										{isSelected ? (
											<CornerDownLeftIcon className='h-4 w-4 shrink-0' />
										) : null}
									</button>
								)
							})
						) : (
							<div className='px-3 py-8 text-center text-sm text-muted-foreground'>
								該当するページがありません
							</div>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
