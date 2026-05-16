export type Country = 'SE' | 'NO' | 'DK' | 'FI';
export type Language = 'sv' | 'en' | 'no' | 'da' | 'fi';

export interface TenantConfig {
  id: string;
  name: string;
  defaultCountry: Country;
  defaultLanguage: Language;
  supportEmail: string;
}

export interface Order {
  id: string;
  number: string;
  customerEmail: string;
  customerName: string | null;
  currency: string;
  totalAmount: number;
  status: 'open' | 'paid' | 'fulfilled' | 'partially_refunded' | 'refunded' | 'cancelled';
  paymentProvider: 'klarna' | 'stripe' | 'adyen' | 'swish' | 'card';
  createdAt: string;
  lineItems: OrderLineItem[];
  shippingAddress: Address | null;
}

export interface OrderLineItem {
  id: string;
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  refundedQuantity: number;
}

export interface Address {
  name: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: Country;
}

export type TrackingStatus =
  | 'pre_transit'
  | 'in_transit'
  | 'out_for_delivery'
  | 'at_pickup_point'
  | 'delivered'
  | 'failed'
  | 'returned'
  | 'exception';

export interface TrackingInfo {
  trackingNumber: string;
  carrier: string;
  status: TrackingStatus;
  statusUpdatedAt: string;
  estimatedDelivery: string | null;
  pickupPointName: string | null;
  events: TrackingEvent[];
}

export interface TrackingEvent {
  at: string;
  status: TrackingStatus;
  description: string;
  location: string | null;
}

export interface RefundInfo {
  orderId: string;
  provider: 'klarna' | 'stripe' | 'adyen' | 'swish' | 'card';
  totalRefundedAmount: number;
  currency: string;
  refunds: RefundEntry[];
  /**
   * Note: for Klarna, this is the merchant-side registration time only.
   * Settlement to the consumer's bank/card is not exposed by the merchant API.
   */
  lifecycleSupported: boolean;
}

export interface RefundEntry {
  id: string;
  amount: number;
  createdAt: string;
  status: 'registered' | 'pending' | 'succeeded' | 'failed' | 'unknown';
  description: string | null;
}
