import { assertLiveCreds, env } from '../../env.ts';
import type { Order } from '../../agent/types.ts';
import { mockOrders, mockTrackingByOrder } from './mock.ts';
import { LiveShopifyClient } from './live.ts';

export interface ShopifyClient {
  getOrderByNumber(orderNumber: string, email: string): Promise<Order | null>;
  getTrackingNumber(orderNumber: string): Promise<string | null>;
}

function normalizeOrderNumber(n: string): string {
  const trimmed = n.trim();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

class MockShopifyClient implements ShopifyClient {
  async getOrderByNumber(orderNumber: string, email: string): Promise<Order | null> {
    const order = mockOrders[normalizeOrderNumber(orderNumber)];
    if (!order) return null;
    if (order.customerEmail.toLowerCase() !== email.toLowerCase()) return null;
    return order;
  }
  async getTrackingNumber(orderNumber: string): Promise<string | null> {
    return mockTrackingByOrder[normalizeOrderNumber(orderNumber)] ?? null;
  }
}

export { MockShopifyClient };

/**
 * Default env-based factory. Use this only when there's a single shop's
 * credentials in env (development, single-tenant scripts).
 *
 * For multi-tenant per-request use, construct `LiveShopifyClient` directly
 * with the per-merchant `{ shopDomain, adminToken }` from the active OAuth
 * session and pass it to `runAgent({ integrations: { shopify } })`.
 */
export function getShopifyClient(): ShopifyClient {
  if (env.integrationMode === 'live') {
    assertLiveCreds('shopify');
    return new LiveShopifyClient({
      shopDomain: env.shopify.shopDomain,
      adminToken: env.shopify.adminToken,
    });
  }
  return new MockShopifyClient();
}
