import type { Country, Order } from '../../agent/types.ts';
import type { ShopifyClient } from './client.ts';

const DEFAULT_API_VERSION = '2024-10';

export interface LiveShopifyConfig {
  shopDomain: string;
  adminToken: string;
  apiVersion?: string;
}

interface ShopifyMoney {
  shopMoney: { amount: string; currencyCode: string };
}

interface ShopifyOrderNode {
  id: string;
  name: string;
  email: string | null;
  customer: { firstName: string | null; lastName: string | null } | null;
  currencyCode: string;
  totalPriceSet: ShopifyMoney;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  createdAt: string;
  shippingAddress: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    zip: string | null;
    city: string | null;
    countryCodeV2: string | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        title: string;
        quantity: number;
        refundableQuantity: number;
        originalUnitPriceSet: ShopifyMoney;
      };
    }>;
  };
  fulfillments: Array<{ trackingInfo: Array<{ number: string | null; company: string | null }> }>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

const ORDER_QUERY = `
  query GetOrder($q: String!) {
    orders(first: 1, query: $q) {
      edges {
        node {
          id
          name
          email
          customer { firstName lastName }
          currencyCode
          totalPriceSet { shopMoney { amount currencyCode } }
          displayFinancialStatus
          displayFulfillmentStatus
          createdAt
          shippingAddress {
            name
            address1
            address2
            zip
            city
            countryCodeV2
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                sku
                title
                quantity
                refundableQuantity
                originalUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
          fulfillments(first: 5) {
            trackingInfo { number company }
          }
        }
      }
    }
  }
`;

export function toMinorUnits(amount: string): number {
  const [whole, fraction = ''] = amount.split('.');
  const paddedFraction = (fraction + '00').slice(0, 2);
  return Number(whole) * 100 + Number(paddedFraction);
}

export function mapStatus(financial: string | null, fulfillment: string | null): Order['status'] {
  if (financial === 'REFUNDED') return 'refunded';
  if (financial === 'PARTIALLY_REFUNDED') return 'partially_refunded';
  if (financial === 'VOIDED') return 'cancelled';
  if (fulfillment === 'FULFILLED') return 'fulfilled';
  if (financial === 'PAID') return 'paid';
  return 'open';
}

function mapCountry(code: string | null): Country | null {
  if (code === 'SE' || code === 'NO' || code === 'DK' || code === 'FI') return code;
  return null;
}

export function mapOrder(node: ShopifyOrderNode): Order {
  const customerName =
    node.customer && (node.customer.firstName || node.customer.lastName)
      ? `${node.customer.firstName ?? ''} ${node.customer.lastName ?? ''}`.trim()
      : null;
  const shipping = node.shippingAddress;
  const shippingCountry = mapCountry(shipping?.countryCodeV2 ?? null);
  return {
    id: node.id,
    number: node.name,
    customerEmail: node.email ?? '',
    customerName,
    currency: node.currencyCode,
    totalAmount: toMinorUnits(node.totalPriceSet.shopMoney.amount),
    status: mapStatus(node.displayFinancialStatus, node.displayFulfillmentStatus),
    paymentProvider: 'klarna',
    createdAt: node.createdAt,
    lineItems: node.lineItems.edges.map(({ node: li }) => ({
      id: li.id,
      sku: li.sku ?? '',
      title: li.title,
      quantity: li.quantity,
      unitPrice: toMinorUnits(li.originalUnitPriceSet.shopMoney.amount),
      refundedQuantity: Math.max(0, li.quantity - li.refundableQuantity),
    })),
    shippingAddress:
      shipping && shippingCountry
        ? {
            name: shipping.name ?? customerName ?? '',
            line1: shipping.address1 ?? '',
            line2: shipping.address2,
            postalCode: shipping.zip ?? '',
            city: shipping.city ?? '',
            country: shippingCountry,
          }
        : null,
  };
}

async function shopifyFetch<T>(
  config: LiveShopifyConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  const url = `https://${config.shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.adminToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  if (!body.data) throw new Error('Shopify: empty response data');
  return body.data;
}

function normalizeOrderName(n: string): string {
  const t = n.trim();
  return t.startsWith('#') ? t : `#${t}`;
}

/**
 * Shopify's search-syntax accepts boolean operators (AND/OR), field prefixes
 * (`field:value`), wildcards, and unquoted values. Raw interpolation of
 * customer input would let `email: a@b.com OR email:*` widen the search
 * arbitrarily.
 *
 * Defense: strict format validation up front, then wrap values in double
 * quotes so they're parsed as literals. The server-side exact-match check
 * in getOrderByNumber is the final guard.
 */
const ORDER_NUMBER_PATTERN = /^#\d{1,15}$/;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,24}$/;

export function safeOrderNameForSearch(name: string): string {
  if (!ORDER_NUMBER_PATTERN.test(name)) {
    throw new Error('Invalid order number format');
  }
  return `"${name}"`;
}

export function safeEmailForSearch(email: string): string {
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('Invalid email format');
  }
  if (email.includes('"') || email.includes('\\')) {
    throw new Error('Email contains disallowed characters');
  }
  return `"${email}"`;
}

export class LiveShopifyClient implements ShopifyClient {
  constructor(private readonly config: LiveShopifyConfig) {
    if (!config.shopDomain) throw new Error('LiveShopifyClient: shopDomain required');
    if (!config.adminToken) throw new Error('LiveShopifyClient: adminToken required');
  }

  async getOrderByNumber(orderNumber: string, email: string): Promise<Order | null> {
    const name = normalizeOrderName(orderNumber);
    const data = await shopifyFetch<{ orders: { edges: Array<{ node: ShopifyOrderNode }> } }>(
      this.config,
      ORDER_QUERY,
      { q: `name:${safeOrderNameForSearch(name)} email:${safeEmailForSearch(email)}` },
    );
    const node = data.orders.edges[0]?.node;
    if (!node) return null;
    if ((node.email ?? '').toLowerCase() !== email.toLowerCase()) return null;
    if (node.name !== name) return null;
    return mapOrder(node);
  }

  async getTrackingNumber(orderNumber: string): Promise<string | null> {
    const name = normalizeOrderName(orderNumber);
    const data = await shopifyFetch<{ orders: { edges: Array<{ node: ShopifyOrderNode }> } }>(
      this.config,
      ORDER_QUERY,
      { q: `name:${safeOrderNameForSearch(name)}` },
    );
    const node = data.orders.edges[0]?.node;
    if (!node) return null;
    for (const f of node.fulfillments) {
      const ti = f.trackingInfo[0];
      if (ti?.number) return ti.number;
    }
    return null;
  }
}
