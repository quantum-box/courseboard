import gql from 'graphql-tag';
import * as Urql from 'urql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /**
   * Implement the DateTime<Utc> scalar
   *
   * The input/output is a string in RFC3339 format.
   */
  DateTime: { input: any; output: any; }
  /** A scalar that can represent any JSON value. */
  JSON: { input: any; output: any; }
  Upload: { input: any; output: any; }
};

export type AddCartItemInput = {
  productId: Scalars['String']['input'];
  quantity: Scalars['Int']['input'];
};

export type Address = {
  __typename?: 'Address';
  address1: Scalars['String']['output'];
  address2?: Maybe<Scalars['String']['output']>;
  city: Scalars['String']['output'];
  postalCode?: Maybe<Scalars['String']['output']>;
  state: Scalars['String']['output'];
};

export type AddressInput = {
  address1: Scalars['String']['input'];
  address2?: InputMaybe<Scalars['String']['input']>;
  city: Scalars['String']['input'];
  postalCode: Scalars['String']['input'];
  state: Scalars['String']['input'];
};

export type AutomationInput = {
  currentStage?: InputMaybe<Scalars['String']['input']>;
  event: Scalars['String']['input'];
  name: Scalars['String']['input'];
  nextStage: Scalars['String']['input'];
  pipeline: Scalars['String']['input'];
};

/** Input for billing information (client_creates_billing) */
export type BillingInformationInput = {
  address: AddressInput;
  email: Scalars['String']['input'];
  name: Scalars['String']['input'];
  phone: Scalars['String']['input'];
};

export type CheckAliasAvailabilityResult = {
  __typename?: 'CheckAliasAvailabilityResult';
  available: Scalars['Boolean']['output'];
  errorCode?: Maybe<Scalars['String']['output']>;
  message?: Maybe<Scalars['String']['output']>;
};

export type CheckoutInput = {
  /** Stripe cancel redirect URL. */
  cancelUrl?: InputMaybe<Scalars['String']['input']>;
  cartId: Scalars['String']['input'];
  /** Optional coupon code for discount (1 per order). */
  couponCode?: InputMaybe<Scalars['String']['input']>;
  /** Customer email for order/pickup notifications. */
  customerEmail?: InputMaybe<Scalars['String']['input']>;
  /** Stable customer ID for sales analytics. */
  customerId?: InputMaybe<Scalars['String']['input']>;
  /** Customer display name snapshot for analytics. */
  customerName?: InputMaybe<Scalars['String']['input']>;
  /** "pickup" or "delivery" */
  fulfillmentMethod?: InputMaybe<Scalars['String']['input']>;
  /** "in_store" or "online" */
  paymentMethod?: InputMaybe<Scalars['String']['input']>;
  /** Requested pickup date-time (ISO 8601) for pickup orders. */
  pickupRequestedAt?: InputMaybe<Scalars['String']['input']>;
  /** Canonical sales channel. */
  salesChannel?: InputMaybe<Scalars['String']['input']>;
  /** Store, marketplace, media, or other channel detail. */
  salesChannelDetail?: InputMaybe<Scalars['String']['input']>;
  shippingAddress?: InputMaybe<Scalars['String']['input']>;
  shippingName?: InputMaybe<Scalars['String']['input']>;
  shippingPhone?: InputMaybe<Scalars['String']['input']>;
  /** Acquisition campaign snapshot. */
  sourceCampaign?: InputMaybe<Scalars['String']['input']>;
  /** Acquisition medium snapshot. */
  sourceMedium?: InputMaybe<Scalars['String']['input']>;
  /** Store ID for pickup orders (bst_ prefix). */
  storeId?: InputMaybe<Scalars['String']['input']>;
  /**
   * Stripe success redirect URL. When provided together with
   * `cancelUrl`, a Stripe Checkout Session is created and its
   * URL is returned in the order's `checkoutUrl`.
   */
  successUrl?: InputMaybe<Scalars['String']['input']>;
};

export type Client = {
  __typename?: 'Client';
  capital?: Maybe<Scalars['Int']['output']>;
  corporationNumber?: Maybe<Scalars['String']['output']>;
  email?: Maybe<Scalars['String']['output']>;
  faxNumber?: Maybe<Scalars['String']['output']>;
  founded?: Maybe<Scalars['String']['output']>;
  headOfficeAddress?: Maybe<Address>;
  id: Scalars['String']['output'];
  industry?: Maybe<Scalars['String']['output']>;
  listed?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  phoneNumber?: Maybe<Scalars['String']['output']>;
  providers: Array<ProviderObject>;
  representative?: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['String']['output'];
};

/** Input for creating a client via SDK */
export type ClientInput = {
  address?: InputMaybe<AddressInput>;
  capital?: InputMaybe<Scalars['Int']['input']>;
  corporateNumber?: InputMaybe<Scalars['String']['input']>;
  email?: InputMaybe<Scalars['String']['input']>;
  faxNumber?: InputMaybe<Scalars['String']['input']>;
  founded?: InputMaybe<Scalars['String']['input']>;
  industry?: InputMaybe<Scalars['String']['input']>;
  listed?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  representative?: InputMaybe<Scalars['String']['input']>;
};

export type ConsumerOrderLookupInput = {
  lastDigits: Scalars['String']['input'];
  phone: Scalars['String']['input'];
};

export type CopyOperatorManifestInput = {
  apiVersion: Scalars['String']['input'];
  kind: Scalars['String']['input'];
  metadata: ManifestMetadataInput;
  spec: Scalars['String']['input'];
};

export type CreateCartInput = {
  sessionId?: InputMaybe<Scalars['String']['input']>;
  userId?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCouponInput = {
  code: Scalars['String']['input'];
  currency?: InputMaybe<Scalars['String']['input']>;
  /** "PERCENTAGE" or "FIXED" */
  discountType: Scalars['String']['input'];
  discountValue: Scalars['Int']['input'];
  /** Mutual exclusion group shared by incompatible coupons. */
  exclusionGroup?: InputMaybe<Scalars['String']['input']>;
  /** ISO 8601 datetime string. `null` means no expiration. */
  expiresAt?: InputMaybe<Scalars['String']['input']>;
  /** Minimum order amount in NanoDollar. `null` means no minimum. */
  minimumOrderAmount?: InputMaybe<Scalars['Int']['input']>;
  usageLimit?: InputMaybe<Scalars['Int']['input']>;
  /** If true, each user can only use this coupon once. */
  usePerUser?: InputMaybe<Scalars['Boolean']['input']>;
};

export type CreateCustomerInput = {
  address?: InputMaybe<CustomerAddressInput>;
  email: Scalars['String']['input'];
  name: Scalars['String']['input'];
  phone?: InputMaybe<Scalars['String']['input']>;
};

export type CreateOperatorInput = {
  newOperatorOwnerId: Scalars['String']['input'];
  newOperatorOwnerMethod: NewOperatorOwnerMethod;
  newOperatorOwnerPassword?: InputMaybe<Scalars['String']['input']>;
  operatorAlias?: InputMaybe<Scalars['String']['input']>;
  operatorName: Scalars['String']['input'];
  platformId: Scalars['String']['input'];
};

export type CustomerAddressInput = {
  address1: Scalars['String']['input'];
  address2?: InputMaybe<Scalars['String']['input']>;
  city: Scalars['String']['input'];
  postalCode: Scalars['String']['input'];
  state: Scalars['String']['input'];
};

export type DeliveryNotePdfPayload = {
  __typename?: 'DeliveryNotePdfPayload';
  expiresAt: Scalars['DateTime']['output'];
  signedUrl: Scalars['String']['output'];
};

export type Empty = {
  __typename?: 'Empty';
  id: Scalars['String']['output'];
};

export type GqlCart = {
  __typename?: 'GqlCart';
  createdAt: Scalars['String']['output'];
  expiresAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  items: Array<GqlCartItem>;
  sessionId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  tenantId: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  userId?: Maybe<Scalars['String']['output']>;
};

export type GqlCartItem = {
  __typename?: 'GqlCartItem';
  id: Scalars['String']['output'];
  productId: Scalars['String']['output'];
  quantity: Scalars['Int']['output'];
  /** Reservation expiry (RFC 3339), null if not reserved. */
  reservedUntil?: Maybe<Scalars['String']['output']>;
  /** NanoDollar amount as String. */
  unitPriceNanodollar: Scalars['String']['output'];
};

/** Sales ranked by channel/detail over the requested window. */
export type GqlChannelSalesRow = {
  __typename?: 'GqlChannelSalesRow';
  customerCount: Scalars['Int']['output'];
  firstOrderDate?: Maybe<Scalars['String']['output']>;
  lastOrderDate?: Maybe<Scalars['String']['output']>;
  orderCount: Scalars['Int']['output'];
  salesChannel: Scalars['String']['output'];
  salesChannelDetail?: Maybe<Scalars['String']['output']>;
  totalNanodollar: Scalars['String']['output'];
};

export type GqlConsumerOrder = {
  __typename?: 'GqlConsumerOrder';
  cancelledAt?: Maybe<Scalars['String']['output']>;
  cartId?: Maybe<Scalars['String']['output']>;
  /** Stripe Checkout Session URL, present when a Stripe payment session was created during checkout. */
  checkoutUrl?: Maybe<Scalars['String']['output']>;
  confirmedAt?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  customerEmail?: Maybe<Scalars['String']['output']>;
  customerId?: Maybe<Scalars['String']['output']>;
  customerName?: Maybe<Scalars['String']['output']>;
  deliveredAt?: Maybe<Scalars['String']['output']>;
  /** Discount applied (NanoDollar). */
  discountNanodollar: Scalars['String']['output'];
  fulfillmentMethod?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  items: Array<GqlConsumerOrderItem>;
  paymentMethod?: Maybe<Scalars['String']['output']>;
  /** Payment settlement state (`unpaid`, `paid`, `refunded`). */
  paymentStatus: Scalars['String']['output'];
  pickedUpAt?: Maybe<Scalars['String']['output']>;
  pickupDeadline?: Maybe<Scalars['String']['output']>;
  pickupRequestedAt?: Maybe<Scalars['String']['output']>;
  readyAt?: Maybe<Scalars['String']['output']>;
  /** Refund timestamp, present only when `payment_status` is `refunded`. */
  refundedAt?: Maybe<Scalars['String']['output']>;
  salesChannel: Scalars['String']['output'];
  salesChannelDetail?: Maybe<Scalars['String']['output']>;
  sessionId?: Maybe<Scalars['String']['output']>;
  shippedAt?: Maybe<Scalars['String']['output']>;
  shippingAddress?: Maybe<Scalars['String']['output']>;
  /** NanoDollar amount as String. */
  shippingFeeNanodollar: Scalars['String']['output'];
  shippingName?: Maybe<Scalars['String']['output']>;
  shippingPhone?: Maybe<Scalars['String']['output']>;
  sourceCampaign?: Maybe<Scalars['String']['output']>;
  sourceMedium?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  storeId?: Maybe<Scalars['String']['output']>;
  /** NanoDollar amount as String. */
  subtotalNanodollar: Scalars['String']['output'];
  tenantId: Scalars['String']['output'];
  /** NanoDollar amount as String. */
  totalNanodollar: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  userId?: Maybe<Scalars['String']['output']>;
};

export type GqlConsumerOrderItem = {
  __typename?: 'GqlConsumerOrderItem';
  id: Scalars['String']['output'];
  productId: Scalars['String']['output'];
  productName: Scalars['String']['output'];
  quantity: Scalars['Int']['output'];
  /** NanoDollar amount as String. */
  subtotalNanodollar: Scalars['String']['output'];
  /** NanoDollar amount as String. */
  unitPriceNanodollar: Scalars['String']['output'];
};

export type GqlConsumerOrderList = {
  __typename?: 'GqlConsumerOrderList';
  items: Array<GqlConsumerOrder>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
};

export type GqlConsumerOrderLookup = {
  __typename?: 'GqlConsumerOrderLookup';
  expiresAt: Scalars['String']['output'];
  lookupToken: Scalars['String']['output'];
  order: GqlConsumerOrder;
};

export type GqlCoupon = {
  __typename?: 'GqlCoupon';
  code: Scalars['String']['output'];
  created: Scalars['Int']['output'];
  createdAt: Scalars['String']['output'];
  currency: Scalars['String']['output'];
  /**
   * Calculated discount in NanoDollar for the given subtotal.
   * Only present when `subtotal_nanodollar` was passed to
   * `validateCoupon`; `null` otherwise.
   */
  discountAmount?: Maybe<Scalars['Int']['output']>;
  discountType: Scalars['String']['output'];
  discountValue: Scalars['Int']['output'];
  /** Mutual exclusion group shared by incompatible coupons. */
  exclusionGroup?: Maybe<Scalars['String']['output']>;
  expiresAt?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  isActive: Scalars['Boolean']['output'];
  minimumOrderAmount?: Maybe<Scalars['Int']['output']>;
  tenantId: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  usageLimit?: Maybe<Scalars['Int']['output']>;
  /** If true, each user can only use this coupon once. */
  usePerUser: Scalars['Boolean']['output'];
  usedCount: Scalars['Int']['output'];
};

export type GqlCouponList = {
  __typename?: 'GqlCouponList';
  data: Array<GqlCoupon>;
  hasMore: Scalars['Boolean']['output'];
};

export type GqlCustomer = {
  __typename?: 'GqlCustomer';
  description?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  phone?: Maybe<Scalars['String']['output']>;
};

export type GqlCustomerList = {
  __typename?: 'GqlCustomerList';
  data: Array<GqlCustomer>;
  hasMore: Scalars['Boolean']['output'];
};

/** Customer ranked by gross revenue over the requested window. */
export type GqlCustomerSalesRow = {
  __typename?: 'GqlCustomerSalesRow';
  customerId?: Maybe<Scalars['String']['output']>;
  /** Stable customer grouping key, with legacy fallbacks. */
  customerKey: Scalars['String']['output'];
  customerKind?: Maybe<Scalars['String']['output']>;
  customerName?: Maybe<Scalars['String']['output']>;
  firstOrderDate?: Maybe<Scalars['String']['output']>;
  lastOrderDate?: Maybe<Scalars['String']['output']>;
  orderCount: Scalars['Int']['output'];
  salesChannel?: Maybe<Scalars['String']['output']>;
  salesChannelDetail?: Maybe<Scalars['String']['output']>;
  totalNanodollar: Scalars['String']['output'];
};

/**
 * One day of confirmed sales for the TACHYON field dashboard.
 *
 * `total_nanodollar` is exposed as `String` so that 64-bit
 * values survive transport through GraphQL clients that
 * otherwise truncate to 32-bit.
 */
export type GqlDailySalesPoint = {
  __typename?: 'GqlDailySalesPoint';
  /** `YYYY-MM-DD`. */
  date: Scalars['String']['output'];
  orderCount: Scalars['Int']['output'];
  totalNanodollar: Scalars['String']['output'];
};

export type GqlDeletedCustomer = {
  __typename?: 'GqlDeletedCustomer';
  deleted: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
};

export type GqlFulfillmentMethod = {
  __typename?: 'GqlFulfillmentMethod';
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

/** One calendar month of confirmed sales. */
export type GqlMonthlySalesPoint = {
  __typename?: 'GqlMonthlySalesPoint';
  orderCount: Scalars['Int']['output'];
  totalNanodollar: Scalars['String']['output'];
  /** `YYYY-MM`. */
  yearMonth: Scalars['String']['output'];
};

/** One monthly YoY/MoM comparison point. */
export type GqlPeriodComparisonPoint = {
  __typename?: 'GqlPeriodComparisonPoint';
  currentNanodollar: Scalars['String']['output'];
  deltaNanodollar: Scalars['String']['output'];
  deltaPercent?: Maybe<Scalars['Float']['output']>;
  orderCount: Scalars['Int']['output'];
  /** `YYYY-MM`. */
  period: Scalars['String']['output'];
  previousNanodollar: Scalars['String']['output'];
  previousOrderCount: Scalars['Int']['output'];
};

export type GqlProductStock = {
  __typename?: 'GqlProductStock';
  createdAt: Scalars['String']['output'];
  id: Scalars['String']['output'];
  lowStockThreshold: Scalars['Int']['output'];
  productId: Scalars['String']['output'];
  quantityAvailable: Scalars['Int']['output'];
  quantityOnHand: Scalars['Int']['output'];
  quantityReserved: Scalars['Int']['output'];
  trackInventory: Scalars['Boolean']['output'];
  updatedAt: Scalars['String']['output'];
};

export type GqlSalesAnalyticsV2ChannelRow = {
  __typename?: 'GqlSalesAnalyticsV2ChannelRow';
  channel: Scalars['String']['output'];
  grossMarginPercent?: Maybe<Scalars['Float']['output']>;
  grossProfitNanodollar: Scalars['String']['output'];
  orderCount: Scalars['Int']['output'];
  totalRevenueNanodollar: Scalars['String']['output'];
  unitsSold: Scalars['Int']['output'];
};

export type GqlSalesAnalyticsV2Dashboard = {
  __typename?: 'GqlSalesAnalyticsV2Dashboard';
  channelRows: Array<GqlSalesAnalyticsV2ChannelRow>;
  exportColumns: Array<GqlSalesAnalyticsV2ExportColumn>;
  skuRows: Array<GqlSalesAnalyticsV2SkuRow>;
  summary: GqlSalesAnalyticsV2Summary;
};

export type GqlSalesAnalyticsV2ExportColumn = {
  __typename?: 'GqlSalesAnalyticsV2ExportColumn';
  key: Scalars['String']['output'];
  label: Scalars['String']['output'];
  unit?: Maybe<Scalars['String']['output']>;
};

export type GqlSalesAnalyticsV2SkuRow = {
  __typename?: 'GqlSalesAnalyticsV2SkuRow';
  currentStockQuantity: Scalars['Int']['output'];
  grossProfitNanodollar: Scalars['String']['output'];
  inventoryTurnover?: Maybe<Scalars['Float']['output']>;
  productId: Scalars['String']['output'];
  productName: Scalars['String']['output'];
  totalQuantity: Scalars['Int']['output'];
  totalRevenueNanodollar: Scalars['String']['output'];
};

export type GqlSalesAnalyticsV2Summary = {
  __typename?: 'GqlSalesAnalyticsV2Summary';
  averageOrderValueNanodollar?: Maybe<Scalars['String']['output']>;
  grossMarginPercent?: Maybe<Scalars['Float']['output']>;
  grossProfitNanodollar: Scalars['String']['output'];
  inventoryTurnover?: Maybe<Scalars['Float']['output']>;
  orderCount: Scalars['Int']['output'];
  totalRevenueNanodollar: Scalars['String']['output'];
  unitsSold: Scalars['Int']['output'];
};

export type GqlStockMovement = {
  __typename?: 'GqlStockMovement';
  createdAt: Scalars['String']['output'];
  id: Scalars['String']['output'];
  movementType: Scalars['String']['output'];
  note?: Maybe<Scalars['String']['output']>;
  productId: Scalars['String']['output'];
  quantity: Scalars['Int']['output'];
  referenceId?: Maybe<Scalars['String']['output']>;
  referenceType?: Maybe<Scalars['String']['output']>;
};

export type GqlStockMovementList = {
  __typename?: 'GqlStockMovementList';
  items: Array<GqlStockMovement>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
};

/** SKU ranked by gross revenue over the requested window. */
export type GqlTopSku = {
  __typename?: 'GqlTopSku';
  productId: Scalars['String']['output'];
  productName: Scalars['String']['output'];
  totalNanodollar: Scalars['String']['output'];
  totalQuantity: Scalars['Int']['output'];
};

export enum Industry {
  Accounting = 'ACCOUNTING',
  AirlinesAviation = 'AIRLINES_AVIATION',
  AlternativeDisputeResolution = 'ALTERNATIVE_DISPUTE_RESOLUTION',
  AlternativeMedicine = 'ALTERNATIVE_MEDICINE',
  Animation = 'ANIMATION',
  ApparelFashion = 'APPAREL_FASHION',
  ArchitecturePlanning = 'ARCHITECTURE_PLANNING',
  ArtsAndCrafts = 'ARTS_AND_CRAFTS',
  Automotive = 'AUTOMOTIVE',
  AviationAerospace = 'AVIATION_AEROSPACE',
  Banking = 'BANKING',
  Biotechnology = 'BIOTECHNOLOGY',
  BroadcastMedia = 'BROADCAST_MEDIA',
  BuildingMaterials = 'BUILDING_MATERIALS',
  BusinessSuppliesAndEquipment = 'BUSINESS_SUPPLIES_AND_EQUIPMENT',
  CapitalMarkets = 'CAPITAL_MARKETS',
  Chemicals = 'CHEMICALS',
  CivicSocialOrganization = 'CIVIC_SOCIAL_ORGANIZATION',
  CivilEngineering = 'CIVIL_ENGINEERING',
  CommercialRealEstate = 'COMMERCIAL_REAL_ESTATE',
  ComputerGames = 'COMPUTER_GAMES',
  ComputerHardware = 'COMPUTER_HARDWARE',
  ComputerNetworking = 'COMPUTER_NETWORKING',
  ComputerNetworkSecurity = 'COMPUTER_NETWORK_SECURITY',
  ComputerSoftware = 'COMPUTER_SOFTWARE',
  Construction = 'CONSTRUCTION',
  ConsumerElectronics = 'CONSUMER_ELECTRONICS',
  ConsumerGoods = 'CONSUMER_GOODS',
  ConsumerServices = 'CONSUMER_SERVICES',
  Cosmetics = 'COSMETICS',
  Dairy = 'DAIRY',
  DefenseSpace = 'DEFENSE_SPACE',
  Design = 'DESIGN',
  EducationManagement = 'EDUCATION_MANAGEMENT',
  ElectricalElectronicManufacturing = 'ELECTRICAL_ELECTRONIC_MANUFACTURING',
  Entertainment = 'ENTERTAINMENT',
  EnvironmentalServices = 'ENVIRONMENTAL_SERVICES',
  EventsServices = 'EVENTS_SERVICES',
  ExecutiveOffice = 'EXECUTIVE_OFFICE',
  ELearning = 'E_LEARNING',
  FacilitiesServices = 'FACILITIES_SERVICES',
  Farming = 'FARMING',
  FinancialServices = 'FINANCIAL_SERVICES',
  FineArt = 'FINE_ART',
  Fishery = 'FISHERY',
  FoodBeverages = 'FOOD_BEVERAGES',
  FoodProduction = 'FOOD_PRODUCTION',
  FundRaising = 'FUND_RAISING',
  Furniture = 'FURNITURE',
  GamblingCasinos = 'GAMBLING_CASINOS',
  GlassCeramicsConcrete = 'GLASS_CERAMICS_CONCRETE',
  GovernmentAdministration = 'GOVERNMENT_ADMINISTRATION',
  GovernmentRelations = 'GOVERNMENT_RELATIONS',
  GraphicDesign = 'GRAPHIC_DESIGN',
  HealthWellnessAndFitness = 'HEALTH_WELLNESS_AND_FITNESS',
  HigherEducation = 'HIGHER_EDUCATION',
  Hospitality = 'HOSPITALITY',
  HospitalHealthCare = 'HOSPITAL_HEALTH_CARE',
  HumanResources = 'HUMAN_RESOURCES',
  Internet = 'INTERNET'
}

export enum Kind {
  ApiService = 'API_SERVICE',
  Option = 'OPTION',
  Plan = 'PLAN',
  Product = 'PRODUCT',
  Software = 'SOFTWARE'
}

export type LineItem = {
  __typename?: 'LineItem';
  discount: Scalars['Float']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  productId: Scalars['String']['output'];
  quantity: Scalars['Int']['output'];
  unitPrice: Scalars['Float']['output'];
};

/** Input for a line item */
export type LineItemInput = {
  discount: Scalars['Float']['input'];
  name: Scalars['String']['input'];
  productId: Scalars['String']['input'];
  quantity: Scalars['Int']['input'];
  unitPrice: Scalars['Float']['input'];
};

export type Manifest = {
  __typename?: 'Manifest';
  apiVersion: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  metadata: ManifestMetadata;
  spec: Scalars['String']['output'];
};

export type ManifestMetadata = {
  __typename?: 'ManifestMetadata';
  name: Scalars['String']['output'];
  operatorId: Scalars['String']['output'];
};

export type ManifestMetadataInput = {
  name: Scalars['String']['input'];
  operatorId: Scalars['String']['input'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /**
   * TODO: add English documentation
   * TODO: add English documentation
   * TODO: add English documentation
   */
  acceptOrderByQuotes: Empty;
  addCartItem: GqlCart;
  adjustStock: GqlProductStock;
  /** Cancel all expired pickup orders. Returns cancelled count. */
  cancelExpiredOrders: Scalars['Int']['output'];
  cancelOrder: Scalars['Boolean']['output'];
  checkAliasAvailability: CheckAliasAvailabilityResult;
  checkout: GqlConsumerOrder;
  clearCart: Scalars['Boolean']['output'];
  clientCreatesBillingInformation: Empty;
  confirmOrder: GqlConsumerOrder;
  /**
   * Confirm a product image upload after the file has been
   * PUT to the presigned URL.
   */
  confirmProductImageUpload: ProductImageConfirmPayload;
  consumerOrderByLookup: GqlConsumerOrderLookup;
  copyOperatorManifest: Array<Manifest>;
  createAutomation: Empty;
  createCart: GqlCart;
  createCheckoutSession: Scalars['String']['output'];
  createClient: Client;
  createCoupon: GqlCoupon;
  createCustomer: GqlCustomer;
  /**
   * Generate a delivery note PDF for a purchase order and return a
   * 15-minute signed URL.
   */
  createDeliveryNotePdf: DeliveryNotePdfPayload;
  createOperator: Operator;
  createProduct: Product;
  /** Generate a quote PDF and return a 15-minute signed URL. */
  createQuotePdf: QuotePdfPayload;
  createQuotes: Empty;
  createSetupPaymentIntent?: Maybe<Scalars['String']['output']>;
  createShippingDestination: Empty;
  deleteAutomation: Empty;
  deleteCustomer: GqlDeletedCustomer;
  deleteOperator: Scalars['String']['output'];
  deleteProduct: Empty;
  /** Delete a variant procurement link via SDK */
  deleteVariantProcurementLink: Scalars['Boolean']['output'];
  deliverOrder: GqlConsumerOrder;
  disableCoupon: GqlCoupon;
  /** Get a presigned upload URL for a product image. */
  getProductImageUploadUrl: ProductImageUploadUrlPayload;
  issueQuote: Empty;
  issueStock: GqlProductStock;
  pickupOrder: GqlConsumerOrder;
  prepareOrder: GqlConsumerOrder;
  readyOrder: GqlConsumerOrder;
  receiveStock: GqlProductStock;
  /**
   * Refund a paid order (full refund) and mark its payment
   * status as `refunded`. Fulfillment status is left untouched.
   */
  refundOrder: GqlConsumerOrder;
  removeCartItem: Scalars['Boolean']['output'];
  saveManifest: Manifest;
  /**
   * Set or update the requested pickup date-time for a BOPIS
   * order.
   *
   * Only pickup orders in `placed` or `ready` status may be
   * updated.  `pickup_requested_at` is an ISO 8601 string
   * (e.g. "2026-04-26T10:00:00Z"); pass `null` to clear.
   */
  selectPickupDatetime: GqlConsumerOrder;
  selfServiceOrder: PurchaseOrder;
  shipOrder: GqlConsumerOrder;
  updateAutomation: Empty;
  updateCartItem: GqlCart;
  updateCoupon: GqlCoupon;
  updateCustomer: GqlCustomer;
  updateProduct: Product;
  updateReorderPoint: GqlProductStock;
  upload: Scalars['String']['output'];
  /** TODO: add English documentation */
  uploadPurchaseOrder: Empty;
  /** Upsert a variant procurement link via SDK */
  upsertVariantProcurementLink: VariantProcurementLink;
};


export type MutationAcceptOrderByQuotesArgs = {
  quoteId: Scalars['ID']['input'];
};


export type MutationAddCartItemArgs = {
  cartId: Scalars['ID']['input'];
  input: AddCartItemInput;
};


export type MutationAdjustStockArgs = {
  input: StockQuantityInput;
  productId: Scalars['ID']['input'];
};


export type MutationCancelOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationCheckAliasAvailabilityArgs = {
  alias: Scalars['String']['input'];
};


export type MutationCheckoutArgs = {
  input: CheckoutInput;
};


export type MutationClearCartArgs = {
  cartId: Scalars['ID']['input'];
};


export type MutationClientCreatesBillingInformationArgs = {
  clientId: Scalars['ID']['input'];
  input: BillingInformationInput;
  quoteId: Scalars['ID']['input'];
};


export type MutationConfirmOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationConfirmProductImageUploadArgs = {
  storageKey: Scalars['String']['input'];
};


export type MutationConsumerOrderByLookupArgs = {
  input: ConsumerOrderLookupInput;
};


export type MutationCopyOperatorManifestArgs = {
  input: CopyOperatorManifestInput;
};


export type MutationCreateAutomationArgs = {
  input: AutomationInput;
};


export type MutationCreateCartArgs = {
  input: CreateCartInput;
};


export type MutationCreateCheckoutSessionArgs = {
  quoteId: Scalars['ID']['input'];
  returningUrl: Scalars['String']['input'];
};


export type MutationCreateClientArgs = {
  input: ClientInput;
};


export type MutationCreateCouponArgs = {
  input: CreateCouponInput;
};


export type MutationCreateCustomerArgs = {
  input: CreateCustomerInput;
};


export type MutationCreateDeliveryNotePdfArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationCreateOperatorArgs = {
  input: CreateOperatorInput;
};


export type MutationCreateProductArgs = {
  input: ProductCreateInput;
};


export type MutationCreateQuotePdfArgs = {
  quoteId: Scalars['ID']['input'];
};


export type MutationCreateQuotesArgs = {
  input: QuotesInput;
};


export type MutationCreateSetupPaymentIntentArgs = {
  clientId: Scalars['ID']['input'];
  tenantId: Scalars['ID']['input'];
};


export type MutationCreateShippingDestinationArgs = {
  input: ShippingDestinationInput;
  quoteId: Scalars['ID']['input'];
};


export type MutationDeleteAutomationArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteCustomerArgs = {
  customerId: Scalars['ID']['input'];
};


export type MutationDeleteOperatorArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteProductArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteVariantProcurementLinkArgs = {
  linkId: Scalars['String']['input'];
  tenant_id: Scalars['String']['input'];
};


export type MutationDeliverOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationDisableCouponArgs = {
  couponId: Scalars['ID']['input'];
};


export type MutationGetProductImageUploadUrlArgs = {
  contentType: Scalars['String']['input'];
  extension: Scalars['String']['input'];
};


export type MutationIssueQuoteArgs = {
  clientId: Scalars['ID']['input'];
  quoteId: Scalars['ID']['input'];
};


export type MutationIssueStockArgs = {
  input: StockQuantityInput;
  productId: Scalars['ID']['input'];
};


export type MutationPickupOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationPrepareOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationReadyOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationReceiveStockArgs = {
  input: StockQuantityInput;
  productId: Scalars['ID']['input'];
};


export type MutationRefundOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationRemoveCartItemArgs = {
  cartId: Scalars['ID']['input'];
  itemId: Scalars['ID']['input'];
};


export type MutationSaveManifestArgs = {
  input: SaveManifestInput;
};


export type MutationSelectPickupDatetimeArgs = {
  orderId: Scalars['ID']['input'];
  pickupRequestedAt?: InputMaybe<Scalars['String']['input']>;
};


export type MutationSelfServiceOrderArgs = {
  input: SelfServiceOrderInput;
};


export type MutationShipOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type MutationUpdateAutomationArgs = {
  id: Scalars['ID']['input'];
  input: AutomationInput;
};


export type MutationUpdateCartItemArgs = {
  cartId: Scalars['ID']['input'];
  input: UpdateCartItemInput;
  itemId: Scalars['ID']['input'];
};


export type MutationUpdateCouponArgs = {
  couponId: Scalars['ID']['input'];
  input: UpdateCouponInput;
};


export type MutationUpdateCustomerArgs = {
  customerId: Scalars['ID']['input'];
  input: UpdateCustomerInput;
};


export type MutationUpdateProductArgs = {
  input: ProductUpdateInput;
};


export type MutationUpdateReorderPointArgs = {
  input: ReorderPointInput;
  productId: Scalars['ID']['input'];
};


export type MutationUploadArgs = {
  file: Scalars['Upload']['input'];
};


export type MutationUploadPurchaseOrderArgs = {
  input: UploadPurchaseOrderInput;
};


export type MutationUpsertVariantProcurementLinkArgs = {
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  procurementCode: Scalars['String']['input'];
  supplierId: Scalars['String']['input'];
  tenant_id: Scalars['String']['input'];
  variantId: Scalars['String']['input'];
};

export enum NewOperatorOwnerMethod {
  Create = 'CREATE',
  Inherit = 'INHERIT'
}

export type OauthProviderConfig = {
  __typename?: 'OauthProviderConfig';
  clientId: Scalars['String']['output'];
  provider: Scalars['String']['output'];
  redirectUri: Scalars['String']['output'];
};

export type Operator = {
  __typename?: 'Operator';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  operatorName: Scalars['String']['output'];
  platform: Platform;
  platformTenantId: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type Order = {
  __typename?: 'Order';
  client: Client;
  clientId: Scalars['String']['output'];
  currency: Scalars['String']['output'];
  id: Scalars['String']['output'];
  lineItems: Array<LineItem>;
  orderDate: Scalars['String']['output'];
  quote: Quote;
  quotesId: Scalars['String']['output'];
  shippingDestination?: Maybe<ShippingDestination>;
  shippingDestinationId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  subtotal: Scalars['Float']['output'];
  tax: Scalars['Float']['output'];
  tenantId: Scalars['String']['output'];
  total: Scalars['Float']['output'];
};

export type PaymentProviderMapping = {
  __typename?: 'PaymentProviderMapping';
  providerId: Scalars['String']['output'];
  providerName: Scalars['String']['output'];
};

export type Pipeline = {
  __typename?: 'Pipeline';
  createdAt: Scalars['String']['output'];
  displayOrder: Scalars['Int']['output'];
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  stages: Array<Stage>;
  updatedAt: Scalars['String']['output'];
};

export type Platform = {
  __typename?: 'Platform';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  operators: Array<Operator>;
  updatedAt: Scalars['DateTime']['output'];
};

export type PlatformManifestTemplate = {
  __typename?: 'PlatformManifestTemplate';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['String']['output'];
  operatorId: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
  value: Scalars['String']['output'];
};

export type Product = {
  __typename?: 'Product';
  billingCycle: Scalars['String']['output'];
  category?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  imageFileIds: Array<Scalars['String']['output']>;
  imageFiles: Array<Scalars['String']['output']>;
  imageStorageKeys: Array<Scalars['String']['output']>;
  /** Return presigned GET URLs for each storage key. */
  imageStorageUrls: Array<Scalars['String']['output']>;
  janCode?: Maybe<Scalars['String']['output']>;
  kind: Scalars['String']['output'];
  listPrice: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  providers: Array<ProviderObject>;
  publicationDescription?: Maybe<Scalars['String']['output']>;
  publicationName?: Maybe<Scalars['String']['output']>;
  publicationStatus: Scalars['String']['output'];
  skuCode?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  subcategory?: Maybe<Scalars['String']['output']>;
  tags: Array<Scalars['String']['output']>;
  tenantId: Scalars['String']['output'];
  upcCode?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
  variants: Array<ProductVariant>;
};

export type ProductConnection = {
  __typename?: 'ProductConnection';
  items: Array<Product>;
  pageInfo: ProductPageInfo;
  totalCount: Scalars['Int']['output'];
};

/** Input for creating a product via SDK */
export type ProductCreateInput = {
  billingCycle: Scalars['String']['input'];
  category?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  /**
   * Optional client-supplied key (one per logical "save" intent, reused on
   * retry) that makes product creation idempotent: replays return the
   * originally created product instead of inserting a duplicate.
   */
  idempotencyKey?: InputMaybe<Scalars['String']['input']>;
  imageStorageKeys?: InputMaybe<Array<Scalars['String']['input']>>;
  janCode?: InputMaybe<Scalars['String']['input']>;
  kind: Scalars['String']['input'];
  listPrice: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  publicationDescription?: InputMaybe<Scalars['String']['input']>;
  publicationName?: InputMaybe<Scalars['String']['input']>;
  publicationStatus?: InputMaybe<Scalars['String']['input']>;
  skuCode?: InputMaybe<Scalars['String']['input']>;
  status: Scalars['String']['input'];
  subcategory?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  upcCode?: InputMaybe<Scalars['String']['input']>;
  variations?: InputMaybe<Array<ProductVariationInput>>;
};

export type ProductImageConfirmPayload = {
  __typename?: 'ProductImageConfirmPayload';
  storageKey: Scalars['String']['output'];
};

export type ProductImageUploadUrlPayload = {
  __typename?: 'ProductImageUploadUrlPayload';
  storageKey: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

export type ProductPageInfo = {
  __typename?: 'ProductPageInfo';
  hasNextPage: Scalars['Boolean']['output'];
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
};

export enum ProductSortOrder {
  NameAsc = 'NAME_ASC',
  PriceAsc = 'PRICE_ASC',
  PriceDesc = 'PRICE_DESC'
}

export enum ProductStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
  Draft = 'DRAFT'
}

/** Input for updating a product via SDK */
export type ProductUpdateInput = {
  billingCycle?: InputMaybe<Scalars['String']['input']>;
  category?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  expectedUpdatedAt?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  imageStorageKeys?: InputMaybe<Array<Scalars['String']['input']>>;
  janCode?: InputMaybe<Scalars['String']['input']>;
  kind?: InputMaybe<Scalars['String']['input']>;
  listPrice?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  publicationDescription?: InputMaybe<Scalars['String']['input']>;
  publicationName?: InputMaybe<Scalars['String']['input']>;
  publicationStatus?: InputMaybe<Scalars['String']['input']>;
  skuCode?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  subcategory?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
  upcCode?: InputMaybe<Scalars['String']['input']>;
  variations?: InputMaybe<Array<ProductUpdateVariationInput>>;
};

/** Input for updating a product variant */
export type ProductUpdateVariationInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  currency?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  publicationDescription?: InputMaybe<Scalars['String']['input']>;
  publicationName?: InputMaybe<Scalars['String']['input']>;
  recurring?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  unitAmount?: InputMaybe<Scalars['Int']['input']>;
};

export type ProductVariant = {
  __typename?: 'ProductVariant';
  code: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['String']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  name: Scalars['String']['output'];
  productId: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export enum ProductVariantStatus {
  Active = 'ACTIVE',
  Archived = 'ARCHIVED',
  Draft = 'DRAFT'
}

/** Input for creating a product variant */
export type ProductVariationInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  currency: Scalars['String']['input'];
  metadata?: InputMaybe<Scalars['JSON']['input']>;
  name: Scalars['String']['input'];
  publicationDescription?: InputMaybe<Scalars['String']['input']>;
  publicationName?: InputMaybe<Scalars['String']['input']>;
  recurring?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  unitAmount: Scalars['Int']['input'];
};

export type ProviderConfigHierarchy = {
  __typename?: 'ProviderConfigHierarchy';
  inheritedFrom?: Maybe<ProviderDefinedAt>;
  providers: Array<ProviderConfigItem>;
  systemTenantId: Scalars['String']['output'];
  tenantId: Scalars['String']['output'];
};

export type ProviderConfigItem = {
  __typename?: 'ProviderConfigItem';
  definedAt?: Maybe<ProviderDefinedAt>;
  hasSecrets: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  providerType: Scalars['String']['output'];
};

export enum ProviderDefinedAt {
  Host = 'HOST',
  Operator = 'OPERATOR',
  Platform = 'PLATFORM'
}

export enum ProviderName {
  Attio = 'ATTIO',
  HubSpot = 'HUB_SPOT',
  Salesforce = 'SALESFORCE'
}

export type ProviderObject = {
  __typename?: 'ProviderObject';
  createdAt: Scalars['String']['output'];
  providerName: Scalars['String']['output'];
  providerPrimaryId: Scalars['String']['output'];
  providerTenantId: Scalars['String']['output'];
};

export enum PublicationStatus {
  Private = 'PRIVATE',
  Public = 'PUBLIC',
  PublicUseDefault = 'PUBLIC_USE_DEFAULT'
}

export type PurchaseOrder = {
  __typename?: 'PurchaseOrder';
  billingInfo?: Maybe<Scalars['String']['output']>;
  clientId: Scalars['String']['output'];
  currency: Scalars['String']['output'];
  deliveryDate?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  invoiceAddress?: Maybe<Scalars['String']['output']>;
  lineItems: Array<LineItem>;
  orderDate: Scalars['String']['output'];
  quotesId: Scalars['String']['output'];
  softwareTenantId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  subtotal: Scalars['Float']['output'];
  tax: Scalars['Float']['output'];
  total: Scalars['Float']['output'];
};

export enum PurchaseOrderStatus {
  ApprovalNeeded = 'APPROVAL_NEEDED',
  Cancelled = 'CANCELLED',
  Confirmed = 'CONFIRMED',
  Pending = 'PENDING'
}

export type Query = {
  __typename?: 'Query';
  cart: GqlCart;
  /** Channels ranked by gross revenue over `[from, to]`. */
  channelSales: Array<GqlChannelSalesRow>;
  client: Client;
  clients: Array<Client>;
  connectedOauthProviders: Array<Scalars['String']['output']>;
  consumerOrder: GqlConsumerOrder;
  consumerOrderByLookupToken?: Maybe<GqlConsumerOrder>;
  consumerOrders: GqlConsumerOrderList;
  coupon: GqlCoupon;
  coupons: GqlCouponList;
  customer: GqlCustomer;
  /** Customers ranked by gross revenue over `[from, to]`. */
  customerSales: Array<GqlCustomerSalesRow>;
  customers: GqlCustomerList;
  /**
   * Daily aggregated sales over `[from, to]` (inclusive).
   * `from`/`to` are `YYYY-MM-DD`.
   */
  dailySales: Array<GqlDailySalesPoint>;
  fulfillmentMethods: Array<GqlFulfillmentMethod>;
  me: User;
  /**
   * Monthly aggregated sales over `[from, to]` (inclusive).
   * `from`/`to` are `YYYY-MM-DD` (typically the first day of
   * each month).
   */
  monthlySales: Array<GqlMonthlySalesPoint>;
  oauthConfigs: Array<OauthProviderConfig>;
  operator: Operator;
  operators: Array<Operator>;
  order: Order;
  orders: Array<Order>;
  payment_providers: Array<PaymentProviderMapping>;
  pipelines: Array<Pipeline>;
  platformManifestTemplate: PlatformManifestTemplate;
  product: Product;
  productStock: GqlProductStock;
  products: ProductConnection;
  providerConfigHierarchy: ProviderConfigHierarchy;
  quote: Quote;
  quotes: Array<Quote>;
  recurringRevenue: RecurringRevenue;
  /** Sales analytics v2 dashboard aggregate over `[from, to]`. */
  salesAnalyticsV2Dashboard: GqlSalesAnalyticsV2Dashboard;
  /** Monthly YoY/MoM sales comparison over `[from, to]`. */
  salesPeriodComparison: Array<GqlPeriodComparisonPoint>;
  stockMovements: GqlStockMovementList;
  storefrontCategories: Array<StorefrontCategory>;
  storefrontProduct: StorefrontProduct;
  storefrontProducts: StorefrontProductList;
  /** Top SKUs ranked by gross revenue over `[from, to]`. */
  topSkus: Array<GqlTopSku>;
  validateCoupon: GqlCoupon;
};


export type QueryCartArgs = {
  cartId: Scalars['ID']['input'];
};


export type QueryChannelSalesArgs = {
  channel?: InputMaybe<Scalars['String']['input']>;
  from: Scalars['String']['input'];
  limit?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
  to: Scalars['String']['input'];
};


export type QueryClientArgs = {
  id: Scalars['ID']['input'];
};


export type QueryConnectedOauthProvidersArgs = {
  operatorId: Scalars['ID']['input'];
};


export type QueryConsumerOrderArgs = {
  orderId: Scalars['ID']['input'];
};


export type QueryConsumerOrderByLookupTokenArgs = {
  lookupToken: Scalars['String']['input'];
};


export type QueryConsumerOrdersArgs = {
  customerId?: InputMaybe<Scalars['String']['input']>;
  limit?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
  sessionId?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
  userId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryCouponArgs = {
  couponId: Scalars['ID']['input'];
};


export type QueryCouponsArgs = {
  activeOnly?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
};


export type QueryCustomerArgs = {
  customerId: Scalars['ID']['input'];
};


export type QueryCustomerSalesArgs = {
  channel?: InputMaybe<Scalars['String']['input']>;
  from: Scalars['String']['input'];
  limit?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
  to: Scalars['String']['input'];
};


export type QueryCustomersArgs = {
  email?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryDailySalesArgs = {
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryMonthlySalesArgs = {
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryOperatorArgs = {
  id: Scalars['ID']['input'];
};


export type QueryOrderArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPayment_ProvidersArgs = {
  productId: Scalars['ID']['input'];
};


export type QueryProductArgs = {
  productId: Scalars['ID']['input'];
};


export type QueryProductStockArgs = {
  productId: Scalars['ID']['input'];
};


export type QueryProductsArgs = {
  limit?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
};


export type QueryProviderConfigHierarchyArgs = {
  operatorId: Scalars['ID']['input'];
};


export type QueryQuoteArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRecurringRevenueArgs = {
  endDate: Scalars['String']['input'];
  revenueCycle: Scalars['String']['input'];
};


export type QuerySalesAnalyticsV2DashboardArgs = {
  channel?: InputMaybe<Scalars['String']['input']>;
  customerSegment?: InputMaybe<Scalars['String']['input']>;
  from: Scalars['String']['input'];
  sku?: InputMaybe<Scalars['String']['input']>;
  to: Scalars['String']['input'];
};


export type QuerySalesPeriodComparisonArgs = {
  channel?: InputMaybe<Scalars['String']['input']>;
  compare: Scalars['String']['input'];
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type QueryStockMovementsArgs = {
  limit?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
  productId: Scalars['ID']['input'];
};


export type QueryStorefrontProductArgs = {
  productId: Scalars['ID']['input'];
};


export type QueryStorefrontProductsArgs = {
  categoryId?: InputMaybe<Scalars['String']['input']>;
  inStock?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
  priceMax?: InputMaybe<Scalars['Int']['input']>;
  priceMin?: InputMaybe<Scalars['Int']['input']>;
  search?: InputMaybe<Scalars['String']['input']>;
  sort?: InputMaybe<ProductSortOrder>;
};


export type QueryTopSkusArgs = {
  from: Scalars['String']['input'];
  limit?: Scalars['Int']['input'];
  to: Scalars['String']['input'];
};


export type QueryValidateCouponArgs = {
  code: Scalars['String']['input'];
  subtotalNanodollar?: InputMaybe<Scalars['Int']['input']>;
};

export type Quote = {
  __typename?: 'Quote';
  client?: Maybe<Client>;
  clientId?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  currency: Scalars['String']['output'];
  id: Scalars['String']['output'];
  lineItems: Array<LineItem>;
  orderDate: Scalars['String']['output'];
  softwareTenantId?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  subtotal: Scalars['Float']['output'];
  tax: Scalars['Int']['output'];
  tenantId: Scalars['String']['output'];
  title: Scalars['String']['output'];
  total: Scalars['Float']['output'];
  updatedAt: Scalars['String']['output'];
  url?: Maybe<Scalars['String']['output']>;
};

export type QuotePdfPayload = {
  __typename?: 'QuotePdfPayload';
  expiresAt: Scalars['DateTime']['output'];
  signedUrl: Scalars['String']['output'];
};

export enum QuoteStatus {
  ApprovalNotNeeded = 'APPROVAL_NOT_NEEDED',
  Approved = 'APPROVED',
  Draft = 'DRAFT',
  PendingApproval = 'PENDING_APPROVAL',
  Rejected = 'REJECTED'
}

/** Input for creating a quote via SDK */
export type QuotesInput = {
  clientId?: InputMaybe<Scalars['String']['input']>;
  lineItems: Array<LineItemInput>;
  title: Scalars['String']['input'];
};

export enum RecurringBillingFrequency {
  Daily = 'DAILY',
  Monthly = 'MONTHLY',
  Once = 'ONCE',
  UsageBased = 'USAGE_BASED',
  Weekly = 'WEEKLY',
  Yearly = 'YEARLY'
}

export type RecurringRevenue = {
  __typename?: 'RecurringRevenue';
  amount: Scalars['Float']['output'];
  changePercentage?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['String']['output'];
  cycle: Scalars['String']['output'];
  endDate: Scalars['String']['output'];
  id: Scalars['String']['output'];
  startDate: Scalars['String']['output'];
  tenantId: Scalars['String']['output'];
};

export type ReorderPointInput = {
  reorderPoint: Scalars['Int']['input'];
};

export enum RevenueCycle {
  Monthly = 'MONTHLY',
  Weekly = 'WEEKLY'
}

export type SaveManifestInput = {
  manifest: Scalars['String']['input'];
  tenantId: Scalars['String']['input'];
};

/** Input for self-service order */
export type SelfServiceOrderInput = {
  address?: InputMaybe<AddressInput>;
  contactEmail?: InputMaybe<Scalars['String']['input']>;
  deliver?: Scalars['Boolean']['input'];
  operatorName?: InputMaybe<Scalars['String']['input']>;
  platformId: Scalars['String']['input'];
  productId?: InputMaybe<Scalars['ID']['input']>;
  quantity?: Scalars['Int']['input'];
  quoteId?: InputMaybe<Scalars['ID']['input']>;
  workspaceName?: InputMaybe<Scalars['String']['input']>;
};

export type ShippingDestination = {
  __typename?: 'ShippingDestination';
  id: Scalars['String']['output'];
};

/** Input for shipping destination */
export type ShippingDestinationInput = {
  address?: InputMaybe<AddressInput>;
  corporateName?: InputMaybe<Scalars['String']['input']>;
  departmentName?: InputMaybe<Scalars['String']['input']>;
  email: Scalars['String']['input'];
  firstName: Scalars['String']['input'];
  lastName: Scalars['String']['input'];
  phoneNumber?: InputMaybe<Scalars['String']['input']>;
  positionName?: InputMaybe<Scalars['String']['input']>;
};

export type Stage = {
  __typename?: 'Stage';
  createdAt: Scalars['String']['output'];
  displayOrder: Scalars['Int']['output'];
  id: Scalars['String']['output'];
  label: Scalars['String']['output'];
  metadata: Scalars['JSON']['output'];
  updatedAt: Scalars['String']['output'];
};

export type StockQuantityInput = {
  note?: InputMaybe<Scalars['String']['input']>;
  quantity: Scalars['Int']['input'];
};

export type StorefrontCategory = {
  __typename?: 'StorefrontCategory';
  id: Scalars['String']['output'];
  imageUrl?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  parentId?: Maybe<Scalars['String']['output']>;
  slug: Scalars['String']['output'];
  sortOrder: Scalars['Int']['output'];
};

export type StorefrontProduct = {
  __typename?: 'StorefrontProduct';
  billingCycle: Scalars['String']['output'];
  categoryId?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['String']['output'];
  imageIds: Array<Scalars['String']['output']>;
  kind: Scalars['String']['output'];
  /** Raw list price from the catalog (u32). */
  listPrice: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  publicationDescription?: Maybe<Scalars['String']['output']>;
  publicationName?: Maybe<Scalars['String']['output']>;
  weightGrams?: Maybe<Scalars['Int']['output']>;
};

export type StorefrontProductList = {
  __typename?: 'StorefrontProductList';
  items: Array<StorefrontProduct>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
};

export type UpdateCartItemInput = {
  quantity: Scalars['Int']['input'];
};

export type UpdateCouponInput = {
  code?: InputMaybe<Scalars['String']['input']>;
  discountType?: InputMaybe<Scalars['String']['input']>;
  discountValue?: InputMaybe<Scalars['Int']['input']>;
  exclusionGroup?: InputMaybe<Scalars['String']['input']>;
  isActive?: InputMaybe<Scalars['Boolean']['input']>;
};

export type UpdateCustomerInput = {
  address?: InputMaybe<CustomerAddressInput>;
  email?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  phone?: InputMaybe<Scalars['String']['input']>;
};

export type UploadPurchaseOrderInput = {
  /** TODO: add English documentation */
  email: Scalars['String']['input'];
  /** TODO: add English documentation */
  file: Scalars['Upload']['input'];
  /** TODO: add English documentation */
  note: Scalars['String']['input'];
  /** TODO: add English documentation */
  quoteId: Scalars['String']['input'];
  /** TODO: add English documentation */
  subject: Scalars['String']['input'];
};

export type User = {
  __typename?: 'User';
  id: Scalars['String']['output'];
  role: Scalars['String']['output'];
};

/** GraphQL representation of a variant procurement link */
export type VariantProcurementLink = {
  __typename?: 'VariantProcurementLink';
  id: Scalars['String']['output'];
  metadata?: Maybe<Scalars['JSON']['output']>;
  procurementCode: Scalars['String']['output'];
  supplierId: Scalars['String']['output'];
  tenantId: Scalars['String']['output'];
  variantId: Scalars['String']['output'];
};

export type GetConsumerOrderDetailQueryVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type GetConsumerOrderDetailQuery = { __typename?: 'Query', consumerOrder: { __typename?: 'GqlConsumerOrder', id: string, tenantId: string, cartId?: string | null, userId?: string | null, sessionId?: string | null, status: string, paymentStatus: string, shippingName?: string | null, shippingAddress?: string | null, shippingPhone?: string | null, customerEmail?: string | null, customerId?: string | null, customerName?: string | null, salesChannel: string, salesChannelDetail?: string | null, sourceMedium?: string | null, sourceCampaign?: string | null, subtotalNanodollar: string, shippingFeeNanodollar: string, totalNanodollar: string, confirmedAt?: string | null, shippedAt?: string | null, deliveredAt?: string | null, cancelledAt?: string | null, refundedAt?: string | null, createdAt: string, updatedAt: string, items: Array<{ __typename?: 'GqlConsumerOrderItem', id: string, productId: string, productName: string, quantity: number, unitPriceNanodollar: string, subtotalNanodollar: string }> } };

export type CancelConsumerOrderMutationMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type CancelConsumerOrderMutationMutation = { __typename?: 'Mutation', cancelOrder: boolean };

export type ConfirmConsumerOrderMutationMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type ConfirmConsumerOrderMutationMutation = { __typename?: 'Mutation', confirmOrder: { __typename?: 'GqlConsumerOrder', id: string, status: string, confirmedAt?: string | null } };

export type PrepareConsumerOrderMutationMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type PrepareConsumerOrderMutationMutation = { __typename?: 'Mutation', prepareOrder: { __typename?: 'GqlConsumerOrder', id: string, status: string } };

export type ShipConsumerOrderMutationMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type ShipConsumerOrderMutationMutation = { __typename?: 'Mutation', shipOrder: { __typename?: 'GqlConsumerOrder', id: string, status: string, shippedAt?: string | null } };

export type DeliverConsumerOrderMutationMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type DeliverConsumerOrderMutationMutation = { __typename?: 'Mutation', deliverOrder: { __typename?: 'GqlConsumerOrder', id: string, status: string, deliveredAt?: string | null } };

export type RefundConsumerOrderMutationMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type RefundConsumerOrderMutationMutation = { __typename?: 'Mutation', refundOrder: { __typename?: 'GqlConsumerOrder', id: string, status: string, paymentStatus: string, refundedAt?: string | null } };

export type GetConsumerOrdersForAdminQueryVariables = Exact<{
  userId?: InputMaybe<Scalars['String']['input']>;
  sessionId?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetConsumerOrdersForAdminQuery = { __typename?: 'Query', consumerOrders: { __typename?: 'GqlConsumerOrderList', limit: number, offset: number, items: Array<{ __typename?: 'GqlConsumerOrder', id: string, tenantId: string, cartId?: string | null, userId?: string | null, sessionId?: string | null, status: string, fulfillmentMethod?: string | null, shippingName?: string | null, customerEmail?: string | null, customerId?: string | null, customerName?: string | null, salesChannel: string, salesChannelDetail?: string | null, sourceMedium?: string | null, sourceCampaign?: string | null, subtotalNanodollar: string, shippingFeeNanodollar: string, totalNanodollar: string, pickupDeadline?: string | null, confirmedAt?: string | null, cancelledAt?: string | null, createdAt: string, updatedAt: string, items: Array<{ __typename?: 'GqlConsumerOrderItem', id: string, productId: string, productName: string, quantity: number, unitPriceNanodollar: string, subtotalNanodollar: string }> }> } };

export type GetStockDetailQueryVariables = Exact<{
  productId: Scalars['ID']['input'];
}>;


export type GetStockDetailQuery = { __typename?: 'Query', storefrontProduct: { __typename?: 'StorefrontProduct', id: string, name: string, kind: string, listPrice: number, billingCycle: string, imageIds: Array<string> }, productStock: { __typename?: 'GqlProductStock', id: string, productId: string, quantityOnHand: number, quantityReserved: number, quantityAvailable: number, lowStockThreshold: number, trackInventory: boolean, createdAt: string, updatedAt: string } };

export type GetStockMovementsForDetailQueryVariables = Exact<{
  productId: Scalars['ID']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetStockMovementsForDetailQuery = { __typename?: 'Query', stockMovements: { __typename?: 'GqlStockMovementList', limit: number, offset: number, items: Array<{ __typename?: 'GqlStockMovement', id: string, productId: string, movementType: string, quantity: number, referenceType?: string | null, referenceId?: string | null, note?: string | null, createdAt: string }> } };

export type ReceiveStockMutationMutationVariables = Exact<{
  productId: Scalars['ID']['input'];
  input: StockQuantityInput;
}>;


export type ReceiveStockMutationMutation = { __typename?: 'Mutation', receiveStock: { __typename?: 'GqlProductStock', id: string, productId: string, quantityOnHand: number, quantityReserved: number, quantityAvailable: number } };

export type AdjustStockMutationMutationVariables = Exact<{
  productId: Scalars['ID']['input'];
  input: StockQuantityInput;
}>;


export type AdjustStockMutationMutation = { __typename?: 'Mutation', adjustStock: { __typename?: 'GqlProductStock', id: string, productId: string, quantityOnHand: number, quantityReserved: number, quantityAvailable: number } };

export type IssueStockMutationMutationVariables = Exact<{
  productId: Scalars['ID']['input'];
  input: StockQuantityInput;
}>;


export type IssueStockMutationMutation = { __typename?: 'Mutation', issueStock: { __typename?: 'GqlProductStock', id: string, productId: string, quantityOnHand: number, quantityReserved: number, quantityAvailable: number } };

export type UpdateReorderPointMutationMutationVariables = Exact<{
  productId: Scalars['ID']['input'];
  input: ReorderPointInput;
}>;


export type UpdateReorderPointMutationMutation = { __typename?: 'Mutation', updateReorderPoint: { __typename?: 'GqlProductStock', id: string, productId: string, lowStockThreshold: number, quantityAvailable: number } };

export type GetInventoryListQueryVariables = Exact<{
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetInventoryListQuery = { __typename?: 'Query', storefrontProducts: { __typename?: 'StorefrontProductList', limit: number, offset: number, items: Array<{ __typename?: 'StorefrontProduct', id: string, name: string, kind: string, imageIds: Array<string> }> } };

export type GetProductStockForListQueryVariables = Exact<{
  productId: Scalars['ID']['input'];
}>;


export type GetProductStockForListQuery = { __typename?: 'Query', productStock: { __typename?: 'GqlProductStock', id: string, productId: string, quantityOnHand: number, quantityReserved: number, quantityAvailable: number, lowStockThreshold: number, trackInventory: boolean } };

export type ClientDetailOnProviderFieldFragment = { __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string };

export type ClientDetailOnClientFieldFragment = { __typename?: 'Client', id: string, name: string, corporationNumber?: string | null, representative?: string | null, capital?: number | null, industry?: string | null, listed?: boolean | null, founded?: string | null, email?: string | null, phoneNumber?: string | null, faxNumber?: string | null, headOfficeAddress?: { __typename?: 'Address', postalCode?: string | null, state: string, city: string, address1: string, address2?: string | null } | null, providers: Array<{ __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string }> };

export type ClientDetailQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type ClientDetailQuery = { __typename?: 'Query', client: { __typename?: 'Client', id: string, name: string, corporationNumber?: string | null, representative?: string | null, capital?: number | null, industry?: string | null, listed?: boolean | null, founded?: string | null, email?: string | null, phoneNumber?: string | null, faxNumber?: string | null, headOfficeAddress?: { __typename?: 'Address', postalCode?: string | null, state: string, city: string, address1: string, address2?: string | null } | null, providers: Array<{ __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string }> } };

export type ItemOnClientFieldFragment = { __typename?: 'Client', id: string, name: string, email?: string | null, phoneNumber?: string | null, industry?: string | null, capital?: number | null, headOfficeAddress?: { __typename?: 'Address', state: string, city: string, address1: string } | null };

export type CreateClientForClientsListMutationVariables = Exact<{
  input: ClientInput;
}>;


export type CreateClientForClientsListMutation = { __typename?: 'Mutation', createClient: { __typename?: 'Client', id: string, name: string, email?: string | null, phoneNumber?: string | null, industry?: string | null, capital?: number | null, headOfficeAddress?: { __typename?: 'Address', state: string, city: string, address1: string } | null } };

export type ClientListPageQueryVariables = Exact<{ [key: string]: never; }>;


export type ClientListPageQuery = { __typename?: 'Query', clients: Array<{ __typename?: 'Client', id: string, name: string, email?: string | null, phoneNumber?: string | null, industry?: string | null, capital?: number | null, headOfficeAddress?: { __typename?: 'Address', state: string, city: string, address1: string } | null }> };

export type ConsumerCustomersForAdminQueryVariables = Exact<{
  email?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type ConsumerCustomersForAdminQuery = { __typename?: 'Query', customers: { __typename?: 'GqlCustomerList', hasMore: boolean, data: Array<{ __typename?: 'GqlCustomer', id: string, name: string, email: string, phone?: string | null, description?: string | null }> } };

export type ProductDetailQueryVariables = Exact<{
  productId: Scalars['ID']['input'];
}>;


export type ProductDetailQuery = { __typename?: 'Query', product: { __typename?: 'Product', id: string, tenantId: string, name: string, description?: string | null, status: string, listPrice: number, billingCycle: string, kind: string, category?: string | null, subcategory?: string | null, tags: Array<string>, skuCode?: string | null, janCode?: string | null, upcCode?: string | null, publicationStatus: string, publicationName?: string | null, publicationDescription?: string | null, updatedAt: string, createdAt: string, imageFiles: Array<string>, imageStorageKeys: Array<string>, imageStorageUrls: Array<string>, providers: Array<{ __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string }>, variants: Array<{ __typename?: 'ProductVariant', id: string, code: string, name: string, status: string, metadata?: any | null }> }, payment_providers: Array<{ __typename?: 'PaymentProviderMapping', providerName: string, providerId: string }> };

export type CreateProductMutationVariables = Exact<{
  input: ProductCreateInput;
}>;


export type CreateProductMutation = { __typename?: 'Mutation', createProduct: { __typename?: 'Product', id: string, tenantId: string, name: string, description?: string | null, status: string, listPrice: number, billingCycle: string, kind: string, category?: string | null, subcategory?: string | null, tags: Array<string>, skuCode?: string | null, janCode?: string | null, upcCode?: string | null, publicationStatus: string, publicationName?: string | null, publicationDescription?: string | null, updatedAt: string, createdAt: string, imageFiles: Array<string>, imageStorageKeys: Array<string>, imageStorageUrls: Array<string>, providers: Array<{ __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string }>, variants: Array<{ __typename?: 'ProductVariant', id: string, code: string, name: string, status: string, metadata?: any | null }> } };

export type UpdateProductMutationVariables = Exact<{
  input: ProductUpdateInput;
}>;


export type UpdateProductMutation = { __typename?: 'Mutation', updateProduct: { __typename?: 'Product', id: string, tenantId: string, name: string, description?: string | null, status: string, listPrice: number, billingCycle: string, kind: string, category?: string | null, subcategory?: string | null, tags: Array<string>, skuCode?: string | null, janCode?: string | null, upcCode?: string | null, publicationStatus: string, publicationName?: string | null, publicationDescription?: string | null, updatedAt: string, createdAt: string, imageFiles: Array<string>, imageStorageKeys: Array<string>, imageStorageUrls: Array<string>, providers: Array<{ __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string }>, variants: Array<{ __typename?: 'ProductVariant', id: string, code: string, name: string, status: string, metadata?: any | null }> } };

export type GetProductImageUploadUrlMutationVariables = Exact<{
  contentType: Scalars['String']['input'];
  extension: Scalars['String']['input'];
}>;


export type GetProductImageUploadUrlMutation = { __typename?: 'Mutation', getProductImageUploadUrl: { __typename?: 'ProductImageUploadUrlPayload', uploadUrl: string, storageKey: string } };

export type ConfirmProductImageUploadMutationVariables = Exact<{
  storageKey: Scalars['String']['input'];
}>;


export type ConfirmProductImageUploadMutation = { __typename?: 'Mutation', confirmProductImageUpload: { __typename?: 'ProductImageConfirmPayload', storageKey: string } };

export type ProductDetailOnProviderFieldFragment = { __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string };

export type ProductDetailOnProductFieldFragment = { __typename?: 'Product', id: string, tenantId: string, name: string, description?: string | null, status: string, listPrice: number, billingCycle: string, kind: string, category?: string | null, subcategory?: string | null, tags: Array<string>, skuCode?: string | null, janCode?: string | null, upcCode?: string | null, publicationStatus: string, publicationName?: string | null, publicationDescription?: string | null, updatedAt: string, createdAt: string, imageFiles: Array<string>, imageStorageKeys: Array<string>, imageStorageUrls: Array<string>, providers: Array<{ __typename?: 'ProviderObject', providerTenantId: string, providerName: string, providerPrimaryId: string }>, variants: Array<{ __typename?: 'ProductVariant', id: string, code: string, name: string, status: string, metadata?: any | null }> };

export type PaymentProviderProductDetailFieldFragment = { __typename?: 'PaymentProviderMapping', providerName: string, providerId: string };

export type GetProuctsForAdminQueryVariables = Exact<{
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
}>;


export type GetProuctsForAdminQuery = { __typename?: 'Query', products: { __typename?: 'ProductConnection', totalCount: number, pageInfo: { __typename?: 'ProductPageInfo', limit: number, offset: number, hasNextPage: boolean }, items: Array<{ __typename?: 'Product', id: string, name: string, kind: string, listPrice: number, status: string, skuCode?: string | null, publicationStatus: string, publicationName?: string | null, createdAt: string, imageFiles: Array<string>, variants: Array<{ __typename?: 'ProductVariant', id: string, name: string, code: string, status: string, metadata?: any | null }> }> } };

export type ProductItemForProductsListFragment = { __typename?: 'Product', id: string, name: string, kind: string, listPrice: number, status: string, skuCode?: string | null, publicationStatus: string, publicationName?: string | null, createdAt: string, imageFiles: Array<string>, variants: Array<{ __typename?: 'ProductVariant', id: string, name: string, code: string, status: string, metadata?: any | null }> };

export type GetProuctForProductsListQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type GetProuctForProductsListQuery = { __typename?: 'Query', product: { __typename?: 'Product', id: string, name: string, kind: string, listPrice: number, status: string, skuCode?: string | null, publicationStatus: string, publicationName?: string | null, createdAt: string, imageFiles: Array<string>, variants: Array<{ __typename?: 'ProductVariant', id: string, name: string, code: string, status: string, metadata?: any | null }> } };

export type QuotesListQueryVariables = Exact<{ [key: string]: never; }>;


export type QuotesListQuery = { __typename?: 'Query', quotes: Array<{ __typename?: 'Quote', id: string, title: string, status: string, clientId?: string | null, subtotal: number, tax: number, total: number, orderDate: string, createdAt: string, client?: { __typename?: 'Client', id: string, name: string } | null, lineItems: Array<{ __typename?: 'LineItem', id: string, name: string, unitPrice: number, quantity: number }> }> };

export type QuoteListItemFragment = { __typename?: 'Quote', id: string, title: string, status: string, clientId?: string | null, subtotal: number, tax: number, total: number, orderDate: string, createdAt: string, client?: { __typename?: 'Client', id: string, name: string } | null, lineItems: Array<{ __typename?: 'LineItem', id: string, name: string, unitPrice: number, quantity: number }> };

export type CreateQuotePdfMutationVariables = Exact<{
  quoteId: Scalars['ID']['input'];
}>;


export type CreateQuotePdfMutation = { __typename?: 'Mutation', createQuotePdf: { __typename?: 'QuotePdfPayload', signedUrl: string, expiresAt: any } };

export type RecentOrderFragment = { __typename?: 'Order', id: string, clientId: string, quotesId: string, currency: string, subtotal: number, tax: number, total: number, orderDate: string, client: { __typename?: 'Client', name: string }, quote: { __typename?: 'Quote', title: string } };

export type RecentOrderQueryVariables = Exact<{ [key: string]: never; }>;


export type RecentOrderQuery = { __typename?: 'Query', orders: Array<{ __typename?: 'Order', id: string, clientId: string, quotesId: string, currency: string, subtotal: number, tax: number, total: number, orderDate: string, client: { __typename?: 'Client', name: string }, quote: { __typename?: 'Quote', title: string } }> };

export type DetailOrderForSearchQueryVariables = Exact<{ [key: string]: never; }>;


export type DetailOrderForSearchQuery = { __typename?: 'Query', orders: Array<{ __typename?: 'Order', id: string }> };

export type DetailOrderFragment = { __typename?: 'Order', id: string, clientId: string, quotesId: string, currency: string, subtotal: number, tax: number, total: number, orderDate: string, lineItems: Array<{ __typename?: 'LineItem', name: string, quantity: number, unitPrice: number, discount: number }>, client: { __typename?: 'Client', name: string, email?: string | null, phoneNumber?: string | null }, quote: { __typename?: 'Quote', title: string } };

export type DetailOrderQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DetailOrderQuery = { __typename?: 'Query', order: { __typename?: 'Order', id: string, clientId: string, quotesId: string, currency: string, subtotal: number, tax: number, total: number, orderDate: string, lineItems: Array<{ __typename?: 'LineItem', name: string, quantity: number, unitPrice: number, discount: number }>, client: { __typename?: 'Client', name: string, email?: string | null, phoneNumber?: string | null }, quote: { __typename?: 'Quote', title: string } } };

export type CreateDeliveryNotePdfMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type CreateDeliveryNotePdfMutation = { __typename?: 'Mutation', createDeliveryNotePdf: { __typename?: 'DeliveryNotePdfPayload', signedUrl: string, expiresAt: any } };

export type CurrentMonthlyRevenueQueryVariables = Exact<{
  endDate: Scalars['String']['input'];
}>;


export type CurrentMonthlyRevenueQuery = { __typename?: 'Query', recurringRevenue: { __typename?: 'RecurringRevenue', amount: number, changePercentage?: number | null } };

export type CurrentWeeklyRevenueQueryVariables = Exact<{
  endDate: Scalars['String']['input'];
}>;


export type CurrentWeeklyRevenueQuery = { __typename?: 'Query', recurringRevenue: { __typename?: 'RecurringRevenue', amount: number, changePercentage?: number | null } };

export type GetDailySalesQueryVariables = Exact<{
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
}>;


export type GetDailySalesQuery = { __typename?: 'Query', dailySales: Array<{ __typename?: 'GqlDailySalesPoint', date: string, totalNanodollar: string, orderCount: number }> };

export type GetMonthlySalesQueryVariables = Exact<{
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
}>;


export type GetMonthlySalesQuery = { __typename?: 'Query', monthlySales: Array<{ __typename?: 'GqlMonthlySalesPoint', yearMonth: string, totalNanodollar: string, orderCount: number }> };

export type GetTopSkusQueryVariables = Exact<{
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
  limit?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetTopSkusQuery = { __typename?: 'Query', topSkus: Array<{ __typename?: 'GqlTopSku', productId: string, productName: string, totalQuantity: number, totalNanodollar: string }> };

export type GetCustomerSalesQueryVariables = Exact<{
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
  channel?: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetCustomerSalesQuery = { __typename?: 'Query', customerSales: Array<{ __typename?: 'GqlCustomerSalesRow', customerKey: string, customerId?: string | null, customerName?: string | null, customerKind?: string | null, salesChannel?: string | null, salesChannelDetail?: string | null, totalNanodollar: string, orderCount: number, firstOrderDate?: string | null, lastOrderDate?: string | null }> };

export type GetChannelSalesQueryVariables = Exact<{
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
}>;


export type GetChannelSalesQuery = { __typename?: 'Query', channelSales: Array<{ __typename?: 'GqlChannelSalesRow', salesChannel: string, salesChannelDetail?: string | null, totalNanodollar: string, orderCount: number, customerCount: number }> };

export type GetSalesAnalyticsV2DashboardQueryVariables = Exact<{
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
  channel?: InputMaybe<Scalars['String']['input']>;
  sku?: InputMaybe<Scalars['String']['input']>;
  customerSegment?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetSalesAnalyticsV2DashboardQuery = { __typename?: 'Query', salesAnalyticsV2Dashboard: { __typename?: 'GqlSalesAnalyticsV2Dashboard', summary: { __typename?: 'GqlSalesAnalyticsV2Summary', totalRevenueNanodollar: string, grossProfitNanodollar: string, grossMarginPercent?: number | null, orderCount: number, unitsSold: number, averageOrderValueNanodollar?: string | null, inventoryTurnover?: number | null }, channelRows: Array<{ __typename?: 'GqlSalesAnalyticsV2ChannelRow', channel: string, totalRevenueNanodollar: string, grossProfitNanodollar: string, orderCount: number, unitsSold: number, grossMarginPercent?: number | null }>, skuRows: Array<{ __typename?: 'GqlSalesAnalyticsV2SkuRow', productId: string, productName: string, totalRevenueNanodollar: string, grossProfitNanodollar: string, totalQuantity: number, currentStockQuantity: number, inventoryTurnover?: number | null }>, exportColumns: Array<{ __typename?: 'GqlSalesAnalyticsV2ExportColumn', key: string, label: string, unit?: string | null }> } };

export type GetProviderConfigForSettingsQueryVariables = Exact<{
  operatorId: Scalars['ID']['input'];
}>;


export type GetProviderConfigForSettingsQuery = { __typename?: 'Query', connectedOauthProviders: Array<string>, providerConfigHierarchy: { __typename?: 'ProviderConfigHierarchy', tenantId: string, inheritedFrom?: ProviderDefinedAt | null, systemTenantId: string, providers: Array<{ __typename?: 'ProviderConfigItem', name: string, providerType: string, definedAt?: ProviderDefinedAt | null, hasSecrets: boolean }> } };

export type GetCouponsForAdminQueryVariables = Exact<{
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  activeOnly?: InputMaybe<Scalars['Boolean']['input']>;
}>;


export type GetCouponsForAdminQuery = { __typename?: 'Query', coupons: { __typename?: 'GqlCouponList', hasMore: boolean, data: Array<{ __typename?: 'GqlCoupon', id: string, code: string, discountType: string, discountValue: number, currency: string, exclusionGroup?: string | null, isActive: boolean, createdAt: string }> } };

export type CreateCouponForAdminMutationVariables = Exact<{
  input: CreateCouponInput;
}>;


export type CreateCouponForAdminMutation = { __typename?: 'Mutation', createCoupon: { __typename?: 'GqlCoupon', id: string, code: string, discountType: string, discountValue: number, currency: string, exclusionGroup?: string | null, isActive: boolean, createdAt: string } };

export type DisableCouponForAdminMutationVariables = Exact<{
  couponId: Scalars['ID']['input'];
}>;


export type DisableCouponForAdminMutation = { __typename?: 'Mutation', disableCoupon: { __typename?: 'GqlCoupon', id: string, code: string, discountType: string, discountValue: number, currency: string, exclusionGroup?: string | null, isActive: boolean, createdAt: string } };

export type CouponItemForAdminFragment = { __typename?: 'GqlCoupon', id: string, code: string, discountType: string, discountValue: number, currency: string, exclusionGroup?: string | null, isActive: boolean, createdAt: string };

export type GetPickupOrdersQueryVariables = Exact<{
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
}>;


export type GetPickupOrdersQuery = { __typename?: 'Query', consumerOrders: { __typename?: 'GqlConsumerOrderList', limit: number, offset: number, items: Array<{ __typename?: 'GqlConsumerOrder', id: string, tenantId: string, userId?: string | null, sessionId?: string | null, status: string, fulfillmentMethod?: string | null, paymentMethod?: string | null, shippingName?: string | null, shippingPhone?: string | null, subtotalNanodollar: string, totalNanodollar: string, pickupDeadline?: string | null, readyAt?: string | null, pickedUpAt?: string | null, cancelledAt?: string | null, createdAt: string, updatedAt: string, items: Array<{ __typename?: 'GqlConsumerOrderItem', id: string, productId: string, productName: string, quantity: number, unitPriceNanodollar: string, subtotalNanodollar: string }> }> } };

export type ReadyOrderMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type ReadyOrderMutation = { __typename?: 'Mutation', readyOrder: { __typename?: 'GqlConsumerOrder', id: string, status: string, readyAt?: string | null, pickupDeadline?: string | null } };

export type PickupOrderMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type PickupOrderMutation = { __typename?: 'Mutation', pickupOrder: { __typename?: 'GqlConsumerOrder', id: string, status: string, pickedUpAt?: string | null } };

export type CancelOrderMutationVariables = Exact<{
  orderId: Scalars['ID']['input'];
}>;


export type CancelOrderMutation = { __typename?: 'Mutation', cancelOrder: boolean };

export type TenantListItemFragment = { __typename?: 'Operator', id: string, name: string, operatorName: string, platformTenantId: string, createdAt: any, updatedAt: any };

export type TenantListPageQueryVariables = Exact<{ [key: string]: never; }>;


export type TenantListPageQuery = { __typename?: 'Query', operators: Array<{ __typename?: 'Operator', id: string, name: string, operatorName: string, platformTenantId: string, createdAt: any, updatedAt: any }> };

export type CreateOperatorMutationVariables = Exact<{
  input: CreateOperatorInput;
}>;


export type CreateOperatorMutation = { __typename?: 'Mutation', createOperator: { __typename?: 'Operator', id: string, name: string, operatorName: string } };

export type DeleteOperatorMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteOperatorMutation = { __typename?: 'Mutation', deleteOperator: string };

export type GetPlatformManifestTemplateQueryVariables = Exact<{ [key: string]: never; }>;


export type GetPlatformManifestTemplateQuery = { __typename?: 'Query', platformManifestTemplate: { __typename?: 'PlatformManifestTemplate', id: string, operatorId: string, value: string } };

export type SaveManifestMutationVariables = Exact<{
  input: SaveManifestInput;
}>;


export type SaveManifestMutation = { __typename?: 'Mutation', saveManifest: { __typename?: 'Manifest', apiVersion: string, kind: string, spec: string, metadata: { __typename?: 'ManifestMetadata', name: string, operatorId: string } } };

export type CopyOperatorManifestMutationVariables = Exact<{
  input: CopyOperatorManifestInput;
}>;


export type CopyOperatorManifestMutation = { __typename?: 'Mutation', copyOperatorManifest: Array<{ __typename?: 'Manifest', apiVersion: string, kind: string, spec: string, metadata: { __typename?: 'ManifestMetadata', name: string, operatorId: string } }> };

export type GetOAuthConfigsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetOAuthConfigsQuery = { __typename?: 'Query', oauthConfigs: Array<{ __typename?: 'OauthProviderConfig', provider: string, clientId: string, redirectUri: string }> };

export type CheckAliasAvailabilityMutationVariables = Exact<{
  alias: Scalars['String']['input'];
}>;


export type CheckAliasAvailabilityMutation = { __typename?: 'Mutation', checkAliasAvailability: { __typename?: 'CheckAliasAvailabilityResult', available: boolean, message?: string | null, errorCode?: string | null } };

export type GetTenantListQueryVariables = Exact<{ [key: string]: never; }>;


export type GetTenantListQuery = { __typename?: 'Query', operators: Array<{ __typename?: 'Operator', id: string, operatorName: string }> };

export type OperatorListItemFragment = { __typename?: 'Operator', id: string, operatorName: string };

export type AccountMenuContentQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type AccountMenuContentQuery = { __typename?: 'Query', operator: { __typename?: 'Operator', id: string, name: string, operatorName: string } };

export type ProductListForCustomerFragment = { __typename?: 'Product', id: string, name: string, description?: string | null, listPrice: number, kind: string, billingCycle: string };

export type ProductPriceTableForCustomerFragment = { __typename?: 'Product', id: string, name: string, description?: string | null, listPrice: number, kind: string, billingCycle: string };

export type DeleteProductMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteProductMutation = { __typename?: 'Mutation', deleteProduct: { __typename?: 'Empty', id: string } };

export type GetConnectedOAuthProvidersQueryVariables = Exact<{
  operatorId: Scalars['ID']['input'];
}>;


export type GetConnectedOAuthProvidersQuery = { __typename?: 'Query', connectedOauthProviders: Array<string> };

export const ClientDetailOnProviderFieldFragmentDoc = gql`
    fragment ClientDetailOnProviderField on ProviderObject {
  providerTenantId
  providerName
  providerPrimaryId
}
    `;
export const ClientDetailOnClientFieldFragmentDoc = gql`
    fragment ClientDetailOnClientField on Client {
  id
  name
  corporationNumber
  headOfficeAddress {
    postalCode
    state
    city
    address1
    address2
  }
  representative
  capital
  industry
  listed
  founded
  email
  phoneNumber
  faxNumber
  providers {
    ...ClientDetailOnProviderField
  }
}
    ${ClientDetailOnProviderFieldFragmentDoc}`;
export const ItemOnClientFieldFragmentDoc = gql`
    fragment ItemOnClientField on Client {
  id
  name
  email
  phoneNumber
  headOfficeAddress {
    state
    city
    address1
  }
  industry
  capital
}
    `;
export const ProductDetailOnProviderFieldFragmentDoc = gql`
    fragment ProductDetailOnProviderField on ProviderObject {
  providerTenantId
  providerName
  providerPrimaryId
}
    `;
export const ProductDetailOnProductFieldFragmentDoc = gql`
    fragment ProductDetailOnProductField on Product {
  id
  tenantId
  name
  description
  status
  listPrice
  billingCycle
  kind
  category
  subcategory
  tags
  skuCode
  janCode
  upcCode
  publicationStatus
  publicationName
  publicationDescription
  updatedAt
  createdAt
  imageFiles
  imageStorageKeys
  imageStorageUrls
  providers {
    ...ProductDetailOnProviderField
  }
  variants {
    id
    code
    name
    status
    metadata
  }
}
    ${ProductDetailOnProviderFieldFragmentDoc}`;
export const PaymentProviderProductDetailFieldFragmentDoc = gql`
    fragment PaymentProviderProductDetailField on PaymentProviderMapping {
  providerName
  providerId
}
    `;
export const ProductItemForProductsListFragmentDoc = gql`
    fragment ProductItemForProductsList on Product {
  id
  name
  kind
  listPrice
  status
  skuCode
  publicationStatus
  publicationName
  createdAt
  imageFiles
  variants {
    id
    name
    code
    status
    metadata
  }
}
    `;
export const QuoteListItemFragmentDoc = gql`
    fragment QuoteListItem on Quote {
  id
  title
  status
  clientId
  client {
    id
    name
  }
  subtotal
  tax
  total
  orderDate
  lineItems {
    id
    name
    unitPrice
    quantity
  }
  createdAt
}
    `;
export const RecentOrderFragmentDoc = gql`
    fragment RecentOrder on Order {
  id
  clientId
  quotesId
  currency
  subtotal
  tax
  total
  orderDate
  client {
    name
  }
  quote {
    title
  }
}
    `;
export const DetailOrderFragmentDoc = gql`
    fragment DetailOrder on Order {
  id
  clientId
  quotesId
  currency
  subtotal
  tax
  total
  orderDate
  lineItems {
    name
    quantity
    unitPrice
    discount
  }
  client {
    name
    email
    phoneNumber
  }
  quote {
    title
  }
}
    `;
export const CouponItemForAdminFragmentDoc = gql`
    fragment CouponItemForAdmin on GqlCoupon {
  id
  code
  discountType
  discountValue
  currency
  exclusionGroup
  isActive
  createdAt
}
    `;
export const TenantListItemFragmentDoc = gql`
    fragment TenantListItem on Operator {
  id
  name
  operatorName
  platformTenantId
  createdAt
  updatedAt
}
    `;
export const OperatorListItemFragmentDoc = gql`
    fragment OperatorListItem on Operator {
  id
  operatorName
}
    `;
export const ProductListForCustomerFragmentDoc = gql`
    fragment ProductListForCustomer on Product {
  id
  name
  description
  listPrice
  kind
  billingCycle
}
    `;
export const ProductPriceTableForCustomerFragmentDoc = gql`
    fragment ProductPriceTableForCustomer on Product {
  id
  name
  description
  listPrice
  kind
  billingCycle
}
    `;
export const GetConsumerOrderDetailDocument = gql`
    query getConsumerOrderDetail($orderId: ID!) {
  consumerOrder(orderId: $orderId) {
    id
    tenantId
    cartId
    userId
    sessionId
    status
    paymentStatus
    shippingName
    shippingAddress
    shippingPhone
    customerEmail
    customerId
    customerName
    salesChannel
    salesChannelDetail
    sourceMedium
    sourceCampaign
    subtotalNanodollar
    shippingFeeNanodollar
    totalNanodollar
    items {
      id
      productId
      productName
      quantity
      unitPriceNanodollar
      subtotalNanodollar
    }
    confirmedAt
    shippedAt
    deliveredAt
    cancelledAt
    refundedAt
    createdAt
    updatedAt
  }
}
    `;

export function useGetConsumerOrderDetailQuery(options: Omit<Urql.UseQueryArgs<GetConsumerOrderDetailQueryVariables>, 'query'>) {
  return Urql.useQuery<GetConsumerOrderDetailQuery, GetConsumerOrderDetailQueryVariables>({ query: GetConsumerOrderDetailDocument, ...options });
};
export const CancelConsumerOrderMutationDocument = gql`
    mutation cancelConsumerOrderMutation($orderId: ID!) {
  cancelOrder(orderId: $orderId)
}
    `;

export function useCancelConsumerOrderMutationMutation() {
  return Urql.useMutation<CancelConsumerOrderMutationMutation, CancelConsumerOrderMutationMutationVariables>(CancelConsumerOrderMutationDocument);
};
export const ConfirmConsumerOrderMutationDocument = gql`
    mutation confirmConsumerOrderMutation($orderId: ID!) {
  confirmOrder(orderId: $orderId) {
    id
    status
    confirmedAt
  }
}
    `;

export function useConfirmConsumerOrderMutationMutation() {
  return Urql.useMutation<ConfirmConsumerOrderMutationMutation, ConfirmConsumerOrderMutationMutationVariables>(ConfirmConsumerOrderMutationDocument);
};
export const PrepareConsumerOrderMutationDocument = gql`
    mutation prepareConsumerOrderMutation($orderId: ID!) {
  prepareOrder(orderId: $orderId) {
    id
    status
  }
}
    `;

export function usePrepareConsumerOrderMutationMutation() {
  return Urql.useMutation<PrepareConsumerOrderMutationMutation, PrepareConsumerOrderMutationMutationVariables>(PrepareConsumerOrderMutationDocument);
};
export const ShipConsumerOrderMutationDocument = gql`
    mutation shipConsumerOrderMutation($orderId: ID!) {
  shipOrder(orderId: $orderId) {
    id
    status
    shippedAt
  }
}
    `;

export function useShipConsumerOrderMutationMutation() {
  return Urql.useMutation<ShipConsumerOrderMutationMutation, ShipConsumerOrderMutationMutationVariables>(ShipConsumerOrderMutationDocument);
};
export const DeliverConsumerOrderMutationDocument = gql`
    mutation deliverConsumerOrderMutation($orderId: ID!) {
  deliverOrder(orderId: $orderId) {
    id
    status
    deliveredAt
  }
}
    `;

export function useDeliverConsumerOrderMutationMutation() {
  return Urql.useMutation<DeliverConsumerOrderMutationMutation, DeliverConsumerOrderMutationMutationVariables>(DeliverConsumerOrderMutationDocument);
};
export const RefundConsumerOrderMutationDocument = gql`
    mutation refundConsumerOrderMutation($orderId: ID!) {
  refundOrder(orderId: $orderId) {
    id
    status
    paymentStatus
    refundedAt
  }
}
    `;

export function useRefundConsumerOrderMutationMutation() {
  return Urql.useMutation<RefundConsumerOrderMutationMutation, RefundConsumerOrderMutationMutationVariables>(RefundConsumerOrderMutationDocument);
};
export const GetConsumerOrdersForAdminDocument = gql`
    query getConsumerOrdersForAdmin($userId: String, $sessionId: String, $limit: Int = 20, $offset: Int = 0) {
  consumerOrders(
    userId: $userId
    sessionId: $sessionId
    limit: $limit
    offset: $offset
  ) {
    items {
      id
      tenantId
      cartId
      userId
      sessionId
      status
      fulfillmentMethod
      shippingName
      customerEmail
      customerId
      customerName
      salesChannel
      salesChannelDetail
      sourceMedium
      sourceCampaign
      subtotalNanodollar
      shippingFeeNanodollar
      totalNanodollar
      items {
        id
        productId
        productName
        quantity
        unitPriceNanodollar
        subtotalNanodollar
      }
      pickupDeadline
      confirmedAt
      cancelledAt
      createdAt
      updatedAt
    }
    limit
    offset
  }
}
    `;

export function useGetConsumerOrdersForAdminQuery(options?: Omit<Urql.UseQueryArgs<GetConsumerOrdersForAdminQueryVariables>, 'query'>) {
  return Urql.useQuery<GetConsumerOrdersForAdminQuery, GetConsumerOrdersForAdminQueryVariables>({ query: GetConsumerOrdersForAdminDocument, ...options });
};
export const GetStockDetailDocument = gql`
    query getStockDetail($productId: ID!) {
  storefrontProduct(productId: $productId) {
    id
    name
    kind
    listPrice
    billingCycle
    imageIds
  }
  productStock(productId: $productId) {
    id
    productId
    quantityOnHand
    quantityReserved
    quantityAvailable
    lowStockThreshold
    trackInventory
    createdAt
    updatedAt
  }
}
    `;

export function useGetStockDetailQuery(options: Omit<Urql.UseQueryArgs<GetStockDetailQueryVariables>, 'query'>) {
  return Urql.useQuery<GetStockDetailQuery, GetStockDetailQueryVariables>({ query: GetStockDetailDocument, ...options });
};
export const GetStockMovementsForDetailDocument = gql`
    query getStockMovementsForDetail($productId: ID!, $limit: Int = 20, $offset: Int = 0) {
  stockMovements(productId: $productId, limit: $limit, offset: $offset) {
    items {
      id
      productId
      movementType
      quantity
      referenceType
      referenceId
      note
      createdAt
    }
    limit
    offset
  }
}
    `;

export function useGetStockMovementsForDetailQuery(options: Omit<Urql.UseQueryArgs<GetStockMovementsForDetailQueryVariables>, 'query'>) {
  return Urql.useQuery<GetStockMovementsForDetailQuery, GetStockMovementsForDetailQueryVariables>({ query: GetStockMovementsForDetailDocument, ...options });
};
export const ReceiveStockMutationDocument = gql`
    mutation receiveStockMutation($productId: ID!, $input: StockQuantityInput!) {
  receiveStock(productId: $productId, input: $input) {
    id
    productId
    quantityOnHand
    quantityReserved
    quantityAvailable
  }
}
    `;

export function useReceiveStockMutationMutation() {
  return Urql.useMutation<ReceiveStockMutationMutation, ReceiveStockMutationMutationVariables>(ReceiveStockMutationDocument);
};
export const AdjustStockMutationDocument = gql`
    mutation adjustStockMutation($productId: ID!, $input: StockQuantityInput!) {
  adjustStock(productId: $productId, input: $input) {
    id
    productId
    quantityOnHand
    quantityReserved
    quantityAvailable
  }
}
    `;

export function useAdjustStockMutationMutation() {
  return Urql.useMutation<AdjustStockMutationMutation, AdjustStockMutationMutationVariables>(AdjustStockMutationDocument);
};
export const IssueStockMutationDocument = gql`
    mutation issueStockMutation($productId: ID!, $input: StockQuantityInput!) {
  issueStock(productId: $productId, input: $input) {
    id
    productId
    quantityOnHand
    quantityReserved
    quantityAvailable
  }
}
    `;

export function useIssueStockMutationMutation() {
  return Urql.useMutation<IssueStockMutationMutation, IssueStockMutationMutationVariables>(IssueStockMutationDocument);
};
export const UpdateReorderPointMutationDocument = gql`
    mutation updateReorderPointMutation($productId: ID!, $input: ReorderPointInput!) {
  updateReorderPoint(productId: $productId, input: $input) {
    id
    productId
    lowStockThreshold
    quantityAvailable
  }
}
    `;

export function useUpdateReorderPointMutationMutation() {
  return Urql.useMutation<UpdateReorderPointMutationMutation, UpdateReorderPointMutationMutationVariables>(UpdateReorderPointMutationDocument);
};
export const GetInventoryListDocument = gql`
    query getInventoryList($limit: Int = 20, $offset: Int = 0) {
  storefrontProducts(limit: $limit, offset: $offset) {
    items {
      id
      name
      kind
      imageIds
    }
    limit
    offset
  }
}
    `;

export function useGetInventoryListQuery(options?: Omit<Urql.UseQueryArgs<GetInventoryListQueryVariables>, 'query'>) {
  return Urql.useQuery<GetInventoryListQuery, GetInventoryListQueryVariables>({ query: GetInventoryListDocument, ...options });
};
export const GetProductStockForListDocument = gql`
    query getProductStockForList($productId: ID!) {
  productStock(productId: $productId) {
    id
    productId
    quantityOnHand
    quantityReserved
    quantityAvailable
    lowStockThreshold
    trackInventory
  }
}
    `;

export function useGetProductStockForListQuery(options: Omit<Urql.UseQueryArgs<GetProductStockForListQueryVariables>, 'query'>) {
  return Urql.useQuery<GetProductStockForListQuery, GetProductStockForListQueryVariables>({ query: GetProductStockForListDocument, ...options });
};
export const ClientDetailDocument = gql`
    query clientDetail($id: ID!) {
  client(id: $id) {
    ...ClientDetailOnClientField
  }
}
    ${ClientDetailOnClientFieldFragmentDoc}`;

export function useClientDetailQuery(options: Omit<Urql.UseQueryArgs<ClientDetailQueryVariables>, 'query'>) {
  return Urql.useQuery<ClientDetailQuery, ClientDetailQueryVariables>({ query: ClientDetailDocument, ...options });
};
export const CreateClientForClientsListDocument = gql`
    mutation createClientForClientsList($input: ClientInput!) {
  createClient(input: $input) {
    id
    name
    email
    phoneNumber
    industry
    capital
    headOfficeAddress {
      state
      city
      address1
    }
  }
}
    `;

export function useCreateClientForClientsListMutation() {
  return Urql.useMutation<CreateClientForClientsListMutation, CreateClientForClientsListMutationVariables>(CreateClientForClientsListDocument);
};
export const ClientListPageDocument = gql`
    query clientListPage {
  clients {
    ...ItemOnClientField
  }
}
    ${ItemOnClientFieldFragmentDoc}`;

export function useClientListPageQuery(options?: Omit<Urql.UseQueryArgs<ClientListPageQueryVariables>, 'query'>) {
  return Urql.useQuery<ClientListPageQuery, ClientListPageQueryVariables>({ query: ClientListPageDocument, ...options });
};
export const ConsumerCustomersForAdminDocument = gql`
    query consumerCustomersForAdmin($email: String, $limit: Int = 100) {
  customers(email: $email, limit: $limit) {
    data {
      id
      name
      email
      phone
      description
    }
    hasMore
  }
}
    `;

export function useConsumerCustomersForAdminQuery(options?: Omit<Urql.UseQueryArgs<ConsumerCustomersForAdminQueryVariables>, 'query'>) {
  return Urql.useQuery<ConsumerCustomersForAdminQuery, ConsumerCustomersForAdminQueryVariables>({ query: ConsumerCustomersForAdminDocument, ...options });
};
export const ProductDetailDocument = gql`
    query productDetail($productId: ID!) {
  product(productId: $productId) {
    ...ProductDetailOnProductField
  }
  payment_providers(productId: $productId) {
    ...PaymentProviderProductDetailField
  }
}
    ${ProductDetailOnProductFieldFragmentDoc}
${PaymentProviderProductDetailFieldFragmentDoc}`;

export function useProductDetailQuery(options: Omit<Urql.UseQueryArgs<ProductDetailQueryVariables>, 'query'>) {
  return Urql.useQuery<ProductDetailQuery, ProductDetailQueryVariables>({ query: ProductDetailDocument, ...options });
};
export const CreateProductDocument = gql`
    mutation createProduct($input: ProductCreateInput!) {
  createProduct(input: $input) {
    ...ProductDetailOnProductField
  }
}
    ${ProductDetailOnProductFieldFragmentDoc}`;

export function useCreateProductMutation() {
  return Urql.useMutation<CreateProductMutation, CreateProductMutationVariables>(CreateProductDocument);
};
export const UpdateProductDocument = gql`
    mutation updateProduct($input: ProductUpdateInput!) {
  updateProduct(input: $input) {
    ...ProductDetailOnProductField
  }
}
    ${ProductDetailOnProductFieldFragmentDoc}`;

export function useUpdateProductMutation() {
  return Urql.useMutation<UpdateProductMutation, UpdateProductMutationVariables>(UpdateProductDocument);
};
export const GetProductImageUploadUrlDocument = gql`
    mutation getProductImageUploadUrl($contentType: String!, $extension: String!) {
  getProductImageUploadUrl(contentType: $contentType, extension: $extension) {
    uploadUrl
    storageKey
  }
}
    `;

export function useGetProductImageUploadUrlMutation() {
  return Urql.useMutation<GetProductImageUploadUrlMutation, GetProductImageUploadUrlMutationVariables>(GetProductImageUploadUrlDocument);
};
export const ConfirmProductImageUploadDocument = gql`
    mutation confirmProductImageUpload($storageKey: String!) {
  confirmProductImageUpload(storageKey: $storageKey) {
    storageKey
  }
}
    `;

export function useConfirmProductImageUploadMutation() {
  return Urql.useMutation<ConfirmProductImageUploadMutation, ConfirmProductImageUploadMutationVariables>(ConfirmProductImageUploadDocument);
};
export const GetProuctsForAdminDocument = gql`
    query getProuctsForAdmin($limit: Int!, $offset: Int!) {
  products(limit: $limit, offset: $offset) {
    totalCount
    pageInfo {
      limit
      offset
      hasNextPage
    }
    items {
      ...ProductItemForProductsList
    }
  }
}
    ${ProductItemForProductsListFragmentDoc}`;

export function useGetProuctsForAdminQuery(options: Omit<Urql.UseQueryArgs<GetProuctsForAdminQueryVariables>, 'query'>) {
  return Urql.useQuery<GetProuctsForAdminQuery, GetProuctsForAdminQueryVariables>({ query: GetProuctsForAdminDocument, ...options });
};
export const GetProuctForProductsListDocument = gql`
    query getProuctForProductsList($id: ID!) {
  product(productId: $id) {
    ...ProductItemForProductsList
  }
}
    ${ProductItemForProductsListFragmentDoc}`;

export function useGetProuctForProductsListQuery(options: Omit<Urql.UseQueryArgs<GetProuctForProductsListQueryVariables>, 'query'>) {
  return Urql.useQuery<GetProuctForProductsListQuery, GetProuctForProductsListQueryVariables>({ query: GetProuctForProductsListDocument, ...options });
};
export const QuotesListDocument = gql`
    query QuotesList {
  quotes {
    ...QuoteListItem
  }
}
    ${QuoteListItemFragmentDoc}`;

export function useQuotesListQuery(options?: Omit<Urql.UseQueryArgs<QuotesListQueryVariables>, 'query'>) {
  return Urql.useQuery<QuotesListQuery, QuotesListQueryVariables>({ query: QuotesListDocument, ...options });
};
export const CreateQuotePdfDocument = gql`
    mutation CreateQuotePdf($quoteId: ID!) {
  createQuotePdf(quoteId: $quoteId) {
    signedUrl
    expiresAt
  }
}
    `;

export function useCreateQuotePdfMutation() {
  return Urql.useMutation<CreateQuotePdfMutation, CreateQuotePdfMutationVariables>(CreateQuotePdfDocument);
};
export const RecentOrderDocument = gql`
    query recentOrder {
  orders {
    ...RecentOrder
  }
}
    ${RecentOrderFragmentDoc}`;

export function useRecentOrderQuery(options?: Omit<Urql.UseQueryArgs<RecentOrderQueryVariables>, 'query'>) {
  return Urql.useQuery<RecentOrderQuery, RecentOrderQueryVariables>({ query: RecentOrderDocument, ...options });
};
export const DetailOrderForSearchDocument = gql`
    query detailOrderForSearch {
  orders {
    id
  }
}
    `;

export function useDetailOrderForSearchQuery(options?: Omit<Urql.UseQueryArgs<DetailOrderForSearchQueryVariables>, 'query'>) {
  return Urql.useQuery<DetailOrderForSearchQuery, DetailOrderForSearchQueryVariables>({ query: DetailOrderForSearchDocument, ...options });
};
export const DetailOrderDocument = gql`
    query detailOrder($id: ID!) {
  order(id: $id) {
    ...DetailOrder
  }
}
    ${DetailOrderFragmentDoc}`;

export function useDetailOrderQuery(options: Omit<Urql.UseQueryArgs<DetailOrderQueryVariables>, 'query'>) {
  return Urql.useQuery<DetailOrderQuery, DetailOrderQueryVariables>({ query: DetailOrderDocument, ...options });
};
export const CreateDeliveryNotePdfDocument = gql`
    mutation CreateDeliveryNotePdf($orderId: ID!) {
  createDeliveryNotePdf(orderId: $orderId) {
    signedUrl
    expiresAt
  }
}
    `;

export function useCreateDeliveryNotePdfMutation() {
  return Urql.useMutation<CreateDeliveryNotePdfMutation, CreateDeliveryNotePdfMutationVariables>(CreateDeliveryNotePdfDocument);
};
export const CurrentMonthlyRevenueDocument = gql`
    query currentMonthlyRevenue($endDate: String!) {
  recurringRevenue(revenueCycle: "MONTHLY", endDate: $endDate) {
    amount
    changePercentage
  }
}
    `;

export function useCurrentMonthlyRevenueQuery(options: Omit<Urql.UseQueryArgs<CurrentMonthlyRevenueQueryVariables>, 'query'>) {
  return Urql.useQuery<CurrentMonthlyRevenueQuery, CurrentMonthlyRevenueQueryVariables>({ query: CurrentMonthlyRevenueDocument, ...options });
};
export const CurrentWeeklyRevenueDocument = gql`
    query currentWeeklyRevenue($endDate: String!) {
  recurringRevenue(revenueCycle: "WEEKLY", endDate: $endDate) {
    amount
    changePercentage
  }
}
    `;

export function useCurrentWeeklyRevenueQuery(options: Omit<Urql.UseQueryArgs<CurrentWeeklyRevenueQueryVariables>, 'query'>) {
  return Urql.useQuery<CurrentWeeklyRevenueQuery, CurrentWeeklyRevenueQueryVariables>({ query: CurrentWeeklyRevenueDocument, ...options });
};
export const GetDailySalesDocument = gql`
    query getDailySales($from: String!, $to: String!) {
  dailySales(from: $from, to: $to) {
    date
    totalNanodollar
    orderCount
  }
}
    `;

export function useGetDailySalesQuery(options: Omit<Urql.UseQueryArgs<GetDailySalesQueryVariables>, 'query'>) {
  return Urql.useQuery<GetDailySalesQuery, GetDailySalesQueryVariables>({ query: GetDailySalesDocument, ...options });
};
export const GetMonthlySalesDocument = gql`
    query getMonthlySales($from: String!, $to: String!) {
  monthlySales(from: $from, to: $to) {
    yearMonth
    totalNanodollar
    orderCount
  }
}
    `;

export function useGetMonthlySalesQuery(options: Omit<Urql.UseQueryArgs<GetMonthlySalesQueryVariables>, 'query'>) {
  return Urql.useQuery<GetMonthlySalesQuery, GetMonthlySalesQueryVariables>({ query: GetMonthlySalesDocument, ...options });
};
export const GetTopSkusDocument = gql`
    query getTopSkus($from: String!, $to: String!, $limit: Int = 10) {
  topSkus(from: $from, to: $to, limit: $limit) {
    productId
    productName
    totalQuantity
    totalNanodollar
  }
}
    `;

export function useGetTopSkusQuery(options: Omit<Urql.UseQueryArgs<GetTopSkusQueryVariables>, 'query'>) {
  return Urql.useQuery<GetTopSkusQuery, GetTopSkusQueryVariables>({ query: GetTopSkusDocument, ...options });
};
export const GetCustomerSalesDocument = gql`
    query getCustomerSales($from: String!, $to: String!, $channel: String, $limit: Int = 10, $offset: Int = 0) {
  customerSales(
    from: $from
    to: $to
    channel: $channel
    limit: $limit
    offset: $offset
  ) {
    customerKey
    customerId
    customerName
    customerKind
    salesChannel
    salesChannelDetail
    totalNanodollar
    orderCount
    firstOrderDate
    lastOrderDate
  }
}
    `;

export function useGetCustomerSalesQuery(options: Omit<Urql.UseQueryArgs<GetCustomerSalesQueryVariables>, 'query'>) {
  return Urql.useQuery<GetCustomerSalesQuery, GetCustomerSalesQueryVariables>({ query: GetCustomerSalesDocument, ...options });
};
export const GetChannelSalesDocument = gql`
    query getChannelSales($from: String!, $to: String!) {
  channelSales(from: $from, to: $to) {
    salesChannel
    salesChannelDetail
    totalNanodollar
    orderCount
    customerCount
  }
}
    `;

export function useGetChannelSalesQuery(options: Omit<Urql.UseQueryArgs<GetChannelSalesQueryVariables>, 'query'>) {
  return Urql.useQuery<GetChannelSalesQuery, GetChannelSalesQueryVariables>({ query: GetChannelSalesDocument, ...options });
};
export const GetSalesAnalyticsV2DashboardDocument = gql`
    query getSalesAnalyticsV2Dashboard($from: String!, $to: String!, $channel: String, $sku: String, $customerSegment: String) {
  salesAnalyticsV2Dashboard(
    from: $from
    to: $to
    channel: $channel
    sku: $sku
    customerSegment: $customerSegment
  ) {
    summary {
      totalRevenueNanodollar
      grossProfitNanodollar
      grossMarginPercent
      orderCount
      unitsSold
      averageOrderValueNanodollar
      inventoryTurnover
    }
    channelRows {
      channel
      totalRevenueNanodollar
      grossProfitNanodollar
      orderCount
      unitsSold
      grossMarginPercent
    }
    skuRows {
      productId
      productName
      totalRevenueNanodollar
      grossProfitNanodollar
      totalQuantity
      currentStockQuantity
      inventoryTurnover
    }
    exportColumns {
      key
      label
      unit
    }
  }
}
    `;

export function useGetSalesAnalyticsV2DashboardQuery(options: Omit<Urql.UseQueryArgs<GetSalesAnalyticsV2DashboardQueryVariables>, 'query'>) {
  return Urql.useQuery<GetSalesAnalyticsV2DashboardQuery, GetSalesAnalyticsV2DashboardQueryVariables>({ query: GetSalesAnalyticsV2DashboardDocument, ...options });
};
export const GetProviderConfigForSettingsDocument = gql`
    query GetProviderConfigForSettings($operatorId: ID!) {
  providerConfigHierarchy(operatorId: $operatorId) {
    tenantId
    providers {
      name
      providerType
      definedAt
      hasSecrets
    }
    inheritedFrom
    systemTenantId
  }
  connectedOauthProviders(operatorId: $operatorId)
}
    `;

export function useGetProviderConfigForSettingsQuery(options: Omit<Urql.UseQueryArgs<GetProviderConfigForSettingsQueryVariables>, 'query'>) {
  return Urql.useQuery<GetProviderConfigForSettingsQuery, GetProviderConfigForSettingsQueryVariables>({ query: GetProviderConfigForSettingsDocument, ...options });
};
export const GetCouponsForAdminDocument = gql`
    query getCouponsForAdmin($limit: Int!, $offset: Int!, $activeOnly: Boolean) {
  coupons(limit: $limit, offset: $offset, activeOnly: $activeOnly) {
    data {
      ...CouponItemForAdmin
    }
    hasMore
  }
}
    ${CouponItemForAdminFragmentDoc}`;

export function useGetCouponsForAdminQuery(options: Omit<Urql.UseQueryArgs<GetCouponsForAdminQueryVariables>, 'query'>) {
  return Urql.useQuery<GetCouponsForAdminQuery, GetCouponsForAdminQueryVariables>({ query: GetCouponsForAdminDocument, ...options });
};
export const CreateCouponForAdminDocument = gql`
    mutation createCouponForAdmin($input: CreateCouponInput!) {
  createCoupon(input: $input) {
    ...CouponItemForAdmin
  }
}
    ${CouponItemForAdminFragmentDoc}`;

export function useCreateCouponForAdminMutation() {
  return Urql.useMutation<CreateCouponForAdminMutation, CreateCouponForAdminMutationVariables>(CreateCouponForAdminDocument);
};
export const DisableCouponForAdminDocument = gql`
    mutation disableCouponForAdmin($couponId: ID!) {
  disableCoupon(couponId: $couponId) {
    ...CouponItemForAdmin
  }
}
    ${CouponItemForAdminFragmentDoc}`;

export function useDisableCouponForAdminMutation() {
  return Urql.useMutation<DisableCouponForAdminMutation, DisableCouponForAdminMutationVariables>(DisableCouponForAdminDocument);
};
export const GetPickupOrdersDocument = gql`
    query getPickupOrders($limit: Int = 20, $offset: Int = 0) {
  consumerOrders(limit: $limit, offset: $offset) {
    items {
      id
      tenantId
      userId
      sessionId
      status
      fulfillmentMethod
      paymentMethod
      shippingName
      shippingPhone
      subtotalNanodollar
      totalNanodollar
      items {
        id
        productId
        productName
        quantity
        unitPriceNanodollar
        subtotalNanodollar
      }
      pickupDeadline
      readyAt
      pickedUpAt
      cancelledAt
      createdAt
      updatedAt
    }
    limit
    offset
  }
}
    `;

export function useGetPickupOrdersQuery(options?: Omit<Urql.UseQueryArgs<GetPickupOrdersQueryVariables>, 'query'>) {
  return Urql.useQuery<GetPickupOrdersQuery, GetPickupOrdersQueryVariables>({ query: GetPickupOrdersDocument, ...options });
};
export const ReadyOrderDocument = gql`
    mutation readyOrder($orderId: ID!) {
  readyOrder(orderId: $orderId) {
    id
    status
    readyAt
    pickupDeadline
  }
}
    `;

export function useReadyOrderMutation() {
  return Urql.useMutation<ReadyOrderMutation, ReadyOrderMutationVariables>(ReadyOrderDocument);
};
export const PickupOrderDocument = gql`
    mutation pickupOrder($orderId: ID!) {
  pickupOrder(orderId: $orderId) {
    id
    status
    pickedUpAt
  }
}
    `;

export function usePickupOrderMutation() {
  return Urql.useMutation<PickupOrderMutation, PickupOrderMutationVariables>(PickupOrderDocument);
};
export const CancelOrderDocument = gql`
    mutation cancelOrder($orderId: ID!) {
  cancelOrder(orderId: $orderId)
}
    `;

export function useCancelOrderMutation() {
  return Urql.useMutation<CancelOrderMutation, CancelOrderMutationVariables>(CancelOrderDocument);
};
export const TenantListPageDocument = gql`
    query TenantListPage {
  operators {
    ...TenantListItem
  }
}
    ${TenantListItemFragmentDoc}`;

export function useTenantListPageQuery(options?: Omit<Urql.UseQueryArgs<TenantListPageQueryVariables>, 'query'>) {
  return Urql.useQuery<TenantListPageQuery, TenantListPageQueryVariables>({ query: TenantListPageDocument, ...options });
};
export const CreateOperatorDocument = gql`
    mutation CreateOperator($input: CreateOperatorInput!) {
  createOperator(input: $input) {
    id
    name
    operatorName
  }
}
    `;

export function useCreateOperatorMutation() {
  return Urql.useMutation<CreateOperatorMutation, CreateOperatorMutationVariables>(CreateOperatorDocument);
};
export const DeleteOperatorDocument = gql`
    mutation DeleteOperator($id: ID!) {
  deleteOperator(id: $id)
}
    `;

export function useDeleteOperatorMutation() {
  return Urql.useMutation<DeleteOperatorMutation, DeleteOperatorMutationVariables>(DeleteOperatorDocument);
};
export const GetPlatformManifestTemplateDocument = gql`
    query GetPlatformManifestTemplate {
  platformManifestTemplate {
    id
    operatorId
    value
  }
}
    `;

export function useGetPlatformManifestTemplateQuery(options?: Omit<Urql.UseQueryArgs<GetPlatformManifestTemplateQueryVariables>, 'query'>) {
  return Urql.useQuery<GetPlatformManifestTemplateQuery, GetPlatformManifestTemplateQueryVariables>({ query: GetPlatformManifestTemplateDocument, ...options });
};
export const SaveManifestDocument = gql`
    mutation SaveManifest($input: SaveManifestInput!) {
  saveManifest(input: $input) {
    apiVersion
    kind
    metadata {
      name
      operatorId
    }
    spec
  }
}
    `;

export function useSaveManifestMutation() {
  return Urql.useMutation<SaveManifestMutation, SaveManifestMutationVariables>(SaveManifestDocument);
};
export const CopyOperatorManifestDocument = gql`
    mutation CopyOperatorManifest($input: CopyOperatorManifestInput!) {
  copyOperatorManifest(input: $input) {
    apiVersion
    kind
    metadata {
      name
      operatorId
    }
    spec
  }
}
    `;

export function useCopyOperatorManifestMutation() {
  return Urql.useMutation<CopyOperatorManifestMutation, CopyOperatorManifestMutationVariables>(CopyOperatorManifestDocument);
};
export const GetOAuthConfigsDocument = gql`
    query GetOAuthConfigs {
  oauthConfigs {
    provider
    clientId
    redirectUri
  }
}
    `;

export function useGetOAuthConfigsQuery(options?: Omit<Urql.UseQueryArgs<GetOAuthConfigsQueryVariables>, 'query'>) {
  return Urql.useQuery<GetOAuthConfigsQuery, GetOAuthConfigsQueryVariables>({ query: GetOAuthConfigsDocument, ...options });
};
export const CheckAliasAvailabilityDocument = gql`
    mutation CheckAliasAvailability($alias: String!) {
  checkAliasAvailability(alias: $alias) {
    available
    message
    errorCode
  }
}
    `;

export function useCheckAliasAvailabilityMutation() {
  return Urql.useMutation<CheckAliasAvailabilityMutation, CheckAliasAvailabilityMutationVariables>(CheckAliasAvailabilityDocument);
};
export const GetTenantListDocument = gql`
    query getTenantList {
  operators {
    ...OperatorListItem
  }
}
    ${OperatorListItemFragmentDoc}`;

export function useGetTenantListQuery(options?: Omit<Urql.UseQueryArgs<GetTenantListQueryVariables>, 'query'>) {
  return Urql.useQuery<GetTenantListQuery, GetTenantListQueryVariables>({ query: GetTenantListDocument, ...options });
};
export const AccountMenuContentDocument = gql`
    query accountMenuContent($id: ID!) {
  operator(id: $id) {
    id
    name
    operatorName
  }
}
    `;

export function useAccountMenuContentQuery(options: Omit<Urql.UseQueryArgs<AccountMenuContentQueryVariables>, 'query'>) {
  return Urql.useQuery<AccountMenuContentQuery, AccountMenuContentQueryVariables>({ query: AccountMenuContentDocument, ...options });
};
export const DeleteProductDocument = gql`
    mutation deleteProduct($id: ID!) {
  deleteProduct(id: $id) {
    id
  }
}
    `;

export function useDeleteProductMutation() {
  return Urql.useMutation<DeleteProductMutation, DeleteProductMutationVariables>(DeleteProductDocument);
};
export const GetConnectedOAuthProvidersDocument = gql`
    query GetConnectedOAuthProviders($operatorId: ID!) {
  connectedOauthProviders(operatorId: $operatorId)
}
    `;

export function useGetConnectedOAuthProvidersQuery(options: Omit<Urql.UseQueryArgs<GetConnectedOAuthProvidersQueryVariables>, 'query'>) {
  return Urql.useQuery<GetConnectedOAuthProvidersQuery, GetConnectedOAuthProvidersQueryVariables>({ query: GetConnectedOAuthProvidersDocument, ...options });
};