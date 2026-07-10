/* eslint-disable */
export type AddCartItemRequest = {
  product_id: string;
  quantity: number;
}

export type AddOperatorRequest = {
  /** Operator (tenant) ID to associate. */
  operator_id: string;
}

export type ApiKeyResponse = {
  createdAt: string;
  id: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  useCases: string[];
}

export type ApprovalFlowListResponse = {
  items: ApprovalFlowResponse[];
}

export type ApprovalFlowResponse = {
  active: boolean;
  createdAt: string;
  id: string;
  name: string;
  resourceType: string;
  steps: ApprovalFlowStep[];
  tenantId: string;
  updatedAt: string;
}

/** Frozen copy of the definition captured when a workflow is requested. */
export type ApprovalFlowSnapshot = {
  definitionId: string;
  name: string;
  steps: ApprovalFlowStep[];
}

/** One stage in a multi-step approval flow definition. */
export type ApprovalFlowStep = {
  /** Role expected to approve this step (informational for now). */
  approverRole: string;
  /** Number of approvals required to clear this step (>= 1). */
  minApprovals: number;
  name: string;
  /** 1-based, sequential order of the step. */
  stepOrder: number;
}

export type ApprovalMutationRequest = {
  action: string;
}

export type ApprovalWorkflowEventResponse = {
  action: string;
  actorId: string;
  createdAt: string;
}

export type ApprovalWorkflowListResponse = {
  items: ApprovalWorkflowResponse[];
}

export type ApprovalWorkflowResponse = {
  createdAt: string;
  /** 1-based current step for multi-stage workflows. `0` = single-stage. */
  currentStep: number;

  definitionSnapshot?: null | ApprovalFlowSnapshot | undefined;

  history: ApprovalWorkflowEventResponse[];
  id: string;
  requestedAt: string;
  requestedBy: string;
  resourceId: string;
  resourceType: string;
  status: string;
  tenantId: string;
  updatedAt: string;
}

export type BillingAccountResponse = {
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
}

export type BridgeActionRequest = {
}

export type BridgeActionResponse = {
  action: string;
  allowed: boolean;
  reason: string;
}

export type BridgeDefinitionListResponse = {
  items: BridgeDefinitionResponse[];
}

export type BridgeDefinitionRequest = {
  mapping: BridgeMapping;
  name: string;
  sourceType: string;
  targetObject: string;
}

export type BridgeDefinitionResponse = {
  createdAt: string;
  id: string;
  mapping: BridgeMapping;
  name: string;
  schemaVersion: string;
  sourceType: string;
  status: string;
  targetObject: string;
  tenantId: string;
  updatedAt: string;
}

export type BridgeMapping = {
  fields: BridgeMappingField[];
}

export type BridgeMappingField = {
  approved?: boolean | undefined;
  required?: boolean | undefined;
  source: string;
  target: string;
}

export type BridgeRunPreviewRequest = {
  rawCsv: string;
}

export type BridgeRunResponse = {
  createdAt: string;
  createdCount: number;
  definitionId: string;
  errorCount: number;
  id: string;
  idempotencyKey: string;
  sourceFileHash: string;
  status: string;
  tenantId: string;
}

/** Response for the cancel-expired-orders batch operation. */
export type CancelExpiredResponse = {
  /** Number of orders cancelled. */
  cancelled_count: number;
}

export type CartItemResponse = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_nanodollar: number;
}

export type CartResponse = {
  created_at: string;
  id: string;
  items: CartItemResponse[];
  status: string;
  tenant_id: string;
  updated_at: string;
}

export type CategoryResponse = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
}

export type CheckoutRequest = {
  cart_id: string;
}

export type ConvertQuotationToInvoiceResponse = {
  invoiceId: string;
  quotation: QuotationResponse;
}

export type CouponResponse = {
  code: string;
  created_at: string;
  currency: string;
  discount_type: string;
  discount_value: number;
  id: string;
  is_active: boolean;
  tenant_id: string;
  updated_at: string;
  use_per_user: boolean;
  used_count: number;
}

export type CreateApiKeyRequest = {
  name: string;
}

export type CreateApiKeyResponse = {
  createdAt: string;
  id: string;
  key: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  useCases: string[];
}

export type CreateApprovalFlowRequest = {
  name: string;
  resourceType: string;
  steps: ApprovalFlowStep[];
}

export type CreateBillingAccountRequest = {
  /** Human-readable name for the billing account. */
  name: string;
}

export type CreateCartRequest = {
}

export type CreateCustomFieldDefinitionRequest = {
  entityType: string;
  fieldKey: string;
  fieldType: string;
  label: string;
}

export type CreateCustomerRequest = {
  address?: null | CustomerAddressRequest | undefined;

  email: string;
  name: string;
}

export type CreateExpenseRequest = {
  amount: number;
  categoryId: string;
  expenseDate: string;
  payee: string;
}

export type CreateInvoiceLineItemRequest = {
  description: string;
  quantity: number;
  unitPrice: number;
}

export type CreateInvoiceRequest = {
  clientId: string;
  dueDate: string;
  lineItems: CreateInvoiceLineItemRequest[];
}

export type CreatePaymentLinkRequest = {
  amount: number;
  description: string;
}

export type CreatePaymentLinkResponse = {
  paymentLinkId: string;
  paymentUrl: string;
  provider: string;
  referenceId: string;
  smsStatus: SmsStatus;
}

export type CreatePurchaseOrderItemRequest = {
  description: string;
  quantity: number;
  unitCost: number;
}

export type CreatePurchaseOrderRequest = {
  items: CreatePurchaseOrderItemRequest[];
  vendorId: string;
}

export type CreateQuotationItemRequest = {
  description: string;
  quantity: number;
  unitPrice: number;
}

export type CreateQuotationRequest = {
  clientId: string;
  items: CreateQuotationItemRequest[];
  validUntil: string;
}

export type CreateVendorRequest = {
  name: string;
}

export type CustomFieldDefinitionListResponse = {
  items: CustomFieldDefinitionResponse[];
}

export type CustomFieldDefinitionResponse = {
  active: boolean;
  createdAt: string;
  entityType: string;
  fieldKey: string;
  fieldType: string;
  id: string;
  label: string;
  required: boolean;
  sortOrder: number;
  tenantId: string;
  updatedAt: string;
}

export type CustomFieldEntityType = 'Client' | 'Product' | 'Order' | 'Invoice' | 'Reservation'

export type CustomFieldType = 'Text' | 'Number' | 'Date' | 'Select' | 'Boolean'

export type CustomFieldValuesResponse = {
  entityId: string;
  entityType: string;
}

export type CustomerAddressRequest = {
  address1: string;
  city: string;
  postal_code: string;
  state: string;
}

export type CustomerResponse = {
  email: string;
  id: string;
  name: string;
}

export type DeleteInvoiceResponse = {
  deleted: boolean;
  id: string;
}

export type DeletedResponse = {
  deleted: boolean;
  id: string;
}

/** Common error response body for REST APIs */
export type ErrorResponse = {
  /** Error code (e.g., "BAD_REQUEST", "NOT_FOUND") */
  code: string;
  /** Error message */
  message: string;
}

export type ExpenseAttachment = {
  id: string;
}

export type ExpenseCategoryListResponse = {
  items: ExpenseCategoryResponse[];
}

export type ExpenseCategoryResponse = {
  createdAt: string;
  id: string;
  isActive: boolean;
  name: string;
  tenantId: string;
  updatedAt: string;
}

export type ExpenseExternalRef = {
  externalId: string;
  provider: ExternalProvider;
  source: string;
  status: ExternalSyncStatus;
}

export type ExpenseListResponse = {
  items: ExpenseResponse[];
}

export type ExpenseResponse = {
  amount: number;
  attachments: ExpenseAttachment[];
  categoryId: string;
  createdAt: string;
  currency: string;
  expenseDate: string;
  externalRefs: ExpenseExternalRef[];
  id: string;
  payee: string;
  status: string;
  taxAmount: number;
  taxCategory: string;
  tenantId: string;
  updatedAt: string;
}

export type ExternalProvider = 'square' | 'freee' | 'manual' | 'other'

export type ExternalSyncStatus = 'pending' | 'synced' | 'failed' | 'ignored'

export type FulfillmentMethodResponse = {
  description: string;
  id: string;
  name: string;
}

export type InvoiceLineItemResponse = {
  amount: number;
  description: string;
  quantity: number;
  taxCategory: string;
  unitPrice: number;
}

export type InvoiceListResponse = {
  items: InvoiceResponse[];
}

export type InvoiceResponse = {
  clientId: string;
  createdAt: string;
  currency: string;
  dueDate: string;
  id: string;
  invoiceNumber: string;
  lineItems: InvoiceLineItemResponse[];
  status: string;
  subtotalAmount: number;
  taxAmount: number;
  taxCategory: string;
  tenantId: string;
  totalAmount: number;
  updatedAt: string;
}

export type MessageResponse = {
  message: string;
}

export type OkResponse = {
  ok: boolean;
}

export type OperatorBillingAccountResponse = {
  billing_account_id: string;
  created_at: string;
  operator_id: string;
}

export type OrderItemResponse = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  subtotal_nanodollar: number;
  unit_price_nanodollar: number;
}

export type OrderResponse = {
  created_at: string;
  discount_nanodollar: number;
  id: string;
  items: OrderItemResponse[];
  payment_status: string;
  sales_channel: string;
  shipping_fee_nanodollar: number;
  status: string;
  subtotal_nanodollar: number;
  tenant_id: string;
  total_nanodollar: number;
  updated_at: string;
}

export type PayoutReportItemResponse = {
  /** Coupon code applied. */
  coupon_code: string;
  /** Discount amount. */
  discount_amount: number;
  /** Net amount after discount. */
  net_amount: number;
  /** Order ID. */
  order_id: string;
  /** Payout amount. */
  payout_amount: number;
  /** Subtotal before discount. */
  subtotal: number;
}

export type PayoutReportResponse = {
  /** Report ID. */
  id: string;
  /** Number of items in the report. */
  item_count: number;
  /** Individual payout items. */
  items: PayoutReportItemResponse[];
  /** Period end date. */
  period_end: string;
  /** Period start date. */
  period_start: string;
  /** Total payout amount. */
  total_payout: number;
  /** Total sales amount. */
  total_sales: number;
}

export type ProductResponse = {
  billing_cycle: string;
  id: string;
  image_ids: string[];
  kind: string;
  list_price: number;
  name: string;
}

export type PublicInvoiceCheckoutResponse = {
  checkoutUrl: string;
}

export type PublicInvoicePaymentIntentResponse = {
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string;
}

export type PublicInvoiceResponse = {
  currency: string;
  dueDate: string;
  id: string;
  invoiceNumber: string;
  lineItems: InvoiceLineItemResponse[];
  status: string;
  subtotalAmount: number;
  taxAmount: number;
  tenantId: string;
  totalAmount: number;
}

export type PublicInvoiceStripePublishableKeyResponse = {
  publishableKey: string;
}

export type PurchaseOrderItemResponse = {
  amount: number;
  description: string;
  quantity: number;
  taxAmount: number;
  taxCategory: string;
  unitCost: number;
}

export type PurchaseOrderListResponse = {
  items: PurchaseOrderResponse[];
}

export type PurchaseOrderResponse = {
  createdAt: string;
  currency: string;
  id: string;
  items: PurchaseOrderItemResponse[];
  purchaseOrderNumber: string;
  status: string;
  subtotalAmount: number;
  taxAmount: number;
  taxCategory: string;
  tenantId: string;
  totalAmount: number;
  updatedAt: string;
  vendorId: string;
  vendorName: string;
}

export type QuotationItemResponse = {
  amount: number;
  description: string;
  discountAmount: number;
  quantity: number;
  unitPrice: number;
}

export type QuotationListResponse = {
  items: QuotationResponse[];
}

export type QuotationResponse = {
  clientId: string;
  createdAt: string;
  currency: string;
  discountAmount: number;
  id: string;
  items: QuotationItemResponse[];
  quotationNumber: string;
  status: string;
  subtotalAmount: number;
  taxAmount: number;
  tenantId: string;
  totalAmount: number;
  updatedAt: string;
  validUntil: string;
}

export type ReconcileSquarePaymentRequest = {
  invoiceId: string;
}

export type RejectExpenseRequest = {
}

export type ResendPaymentLinkRequest = {
}

export type SelectPickupDatetimeRequest = {
}

export type SetCustomFieldValuesRequest = {
}

export type SmsStatus = 'not_requested' | 'sent' | 'failed'

export type SquarePaymentReconciliationListResponse = {
  items: SquarePaymentReconciliationResponse[];
}

export type SquarePaymentReconciliationResponse = {
  amount: number;
  createdAt: string;
  currency: string;
  id: string;
  receivedAt: string;
  squarePaymentId: string;
  status: string;
  tenantId: string;
  updatedAt: string;
}

export type StockResponse = {
  created_at: string;
  id: string;
  low_stock_threshold: number;
  product_id: string;
  quantity_available: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  track_inventory: boolean;
  updated_at: string;
}

export type StoreKitList_CustomerResponse = {
  has_more: boolean;
  items: {
    email: string;
    id: string;
    name: string;
  }[];
  limit: number;
  offset: number;
}

export type StoreKitList_OrderResponse = {
  has_more: boolean;
  items: {
    created_at: string;
    discount_nanodollar: number;
    id: string;
    items: OrderItemResponse[];
    payment_status: string;
    sales_channel: string;
    shipping_fee_nanodollar: number;
    status: string;
    subtotal_nanodollar: number;
    tenant_id: string;
    total_nanodollar: number;
    updated_at: string;
  }[];
  limit: number;
  offset: number;
}

export type StoreKitList_ProductResponse = {
  has_more: boolean;
  items: {
    billing_cycle: string;
    id: string;
    image_ids: string[];
    kind: string;
    list_price: number;
    name: string;
  }[];
  limit: number;
  offset: number;
}

export type UpdateApprovalFlowRequest = {
  name: string;
  steps: ApprovalFlowStep[];
}

export type UpdateBillingAccountRequest = {
  /** Updated name for the billing account. */
  name: string;
}

export type UpdateCartItemRequest = {
  quantity: number;
}

export type UpdateCustomFieldDefinitionRequest = {
}

export type UpdateCustomerRequest = {
  address?: null | CustomerAddressRequest | undefined;
}

export type UpdateExpenseRequest = {
}

export type UpdateInvoiceFollowUpStatusRequest = {
  status: string;
}

export type UpdateInvoiceRequest = {
}

export type UpdatePurchaseOrderRequest = {
}

export type UpdateQuotationRequest = {
}

export type UpdateVendorRequest = {
}

export type UpsertCategoryRequest = {
}

export type ValidateCouponRequest = {
  code: string;
}

export type VendorListResponse = {
  items: VendorResponse[];
}

export type VendorResponse = {
  createdAt: string;
  defaultTaxCategory: string;
  id: string;
  name: string;
  status: string;
  tenantId: string;
  updatedAt: string;
}
