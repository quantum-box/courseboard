/**
 * String constants that were previously GraphQL enums.
 * The schema now uses plain String types for these fields.
 */

export const Kind = {
	ApiService: 'API_SERVICE',
	Option: 'OPTION',
	Plan: 'PLAN',
	Product: 'PRODUCT',
	Software: 'SOFTWARE',
} as const
export type Kind = (typeof Kind)[keyof typeof Kind]

export const ProductStatus = {
	Active: 'ACTIVE',
	Archived: 'ARCHIVED',
	Draft: 'DRAFT',
} as const
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus]

export const ProviderName = {
	HubSpot: 'HUB_SPOT',
	Salesforce: 'SALESFORCE',
} as const
export type ProviderName = (typeof ProviderName)[keyof typeof ProviderName]

export const PublicationStatus = {
	Private: 'PRIVATE',
	Public: 'PUBLIC',
	PublicUseDefault: 'PUBLIC_USE_DEFAULT',
} as const
export type PublicationStatus =
	(typeof PublicationStatus)[keyof typeof PublicationStatus]

export const RecurringBillingFrequency = {
	Daily: 'DAILY',
	Monthly: 'MONTHLY',
	Once: 'ONCE',
	UsageBased: 'USAGE_BASED',
	Weekly: 'WEEKLY',
	Yearly: 'YEARLY',
} as const
export type RecurringBillingFrequency =
	(typeof RecurringBillingFrequency)[keyof typeof RecurringBillingFrequency]
