'use client'

import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { useAdminI18n, type AdminLocale } from 'lib/admin-i18n'
import { CheckIcon, GlobeIcon } from 'lucide-react'

const localeOptions: AdminLocale[] = ['ja', 'en']

export function LanguageSettingsCard() {
	const { locale, setLocale, t } = useAdminI18n()

	return (
		<Card>
			<CardHeader>
				<CardTitle className='flex items-center gap-2'>
					<GlobeIcon className='h-4 w-4' />
					{t('language.title')}
				</CardTitle>
				<CardDescription>{t('language.description')}</CardDescription>
			</CardHeader>
			<CardContent className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
				<p className='text-sm text-muted-foreground'>
					{t('language.current')}: {t(`language.${locale}`)}
				</p>
				<div className='inline-flex rounded-md border bg-background p-1'>
					{localeOptions.map(option => (
						<Button
							key={option}
							type='button'
							size='sm'
							variant={locale === option ? 'default' : 'ghost'}
							onClick={() => setLocale(option)}
							className='gap-2'
							aria-label={`${t('language.switchTo')}: ${t(`language.${option}`)}`}
						>
							{locale === option ? <CheckIcon className='h-4 w-4' /> : null}
							{t(`language.${option}`)}
						</Button>
					))}
				</div>
			</CardContent>
		</Card>
	)
}
