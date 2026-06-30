export type SaasSubscriptionStatus =
	| 'active'
	| 'trial'
	| 'change_requested'
	| 'renewal_review'
	| 'cancelled'

export type SaasSubscription = {
	id: string
	serviceName: string
	ownerTeam: string
	currentPlan: string
	nextPlan?: string
	status: SaasSubscriptionStatus
	monthlyAmount: number
	billingCycle: 'monthly' | 'annual'
	renewalDate: string
	seats: number
	reason: string
	approvalState: 'approved' | 'pending' | 'needs_review'
}

export type SaasChangeRequest = {
	id: string
	subscriptionId?: string
	serviceName: string
	requester: string
	changeType: 'new' | 'plan_change' | 'seat_change' | 'cancel'
	fromPlan?: string
	toPlan?: string
	reason: string
	requestedAt: string
	estimatedDelta: number
	approver: string
	state: 'draft' | 'waiting_approval' | 'approved' | 'returned'
}
