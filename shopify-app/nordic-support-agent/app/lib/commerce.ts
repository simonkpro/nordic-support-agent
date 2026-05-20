import {
  getShopifyClient,
  getKlarnaClient,
  getPostNordClient,
  type OrderSummary,
  type TrackingSummary,
  type RefundSummary,
} from '@nordic-support/agent';

/**
 * Build the commerce adapter functions the agent's tools call into. The
 * underlying clients live in the agent package and honour `INTEGRATION_MODE`:
 *   - 'mock' (default in dev)  → returns sample orders / tracking / refunds
 *     from packages/agent/src/integrations/*\/mock.ts
 *   - 'live'                   → contacts the real Shopify / Klarna /
 *     PostNord APIs (needs the matching env credentials)
 *
 * The agent's tools.ts treats each adapter as optional — when undefined
 * the matching tool is omitted from the toolset, so a tenant with no
 * commerce wiring sees only knowledge-base + handoff.
 *
 * For now this is single-tenant: the env credentials apply to whichever
 * shop is running. Multi-tenant per-request adapters (one merchant's
 * Shopify token per call) will plug in here without changing the route's
 * call signature.
 */

export interface CommerceAdapters {
  lookupOrder?: (orderNumber: string, email: string) => Promise<OrderSummary | null>;
  lookupTracking?: (orderNumber: string) => Promise<TrackingSummary | null>;
  lookupRefund?: (orderNumber: string) => Promise<RefundSummary | null>;
}

let cached: CommerceAdapters | null = null;

export function getCommerceAdapters(_shop: string): CommerceAdapters {
  if (cached) return cached;
  // Each get*Client throws in live mode without credentials; in mock mode
  // they always succeed. We instantiate lazily inside each adapter so a
  // partially-configured live setup (e.g. Shopify creds present, Klarna
  // missing) still lets the working adapters function — the missing one
  // becomes a runtime "not_configured" surface from the agent's side.
  const shopify = safe(() => getShopifyClient());
  const klarna = safe(() => getKlarnaClient());
  const postnord = safe(() => getPostNordClient());

  const adapters: CommerceAdapters = {};
  if (shopify) {
    adapters.lookupOrder = async (n, e) => {
      const o = await shopify.getOrderByNumber(n, e);
      if (!o) return null;
      return {
        number: o.number,
        currency: o.currency,
        totalAmount: o.totalAmount,
        status: o.status,
        paymentProvider: o.paymentProvider,
        createdAt: o.createdAt,
        lineItemCount: o.lineItems.length,
        full: o,
      };
    };
  }
  if (shopify && postnord) {
    adapters.lookupTracking = async (n) => {
      const num = await shopify.getTrackingNumber(n);
      if (!num) return null;
      const data = await postnord.getTracking(num);
      return { data };
    };
  }
  if (klarna) {
    adapters.lookupRefund = async (n) => {
      const data = await klarna.getRefundInfo(n);
      return { data };
    };
  }
  cached = adapters;
  return adapters;
}

function safe<T>(factory: () => T): T | null {
  try {
    return factory();
  } catch (err) {
    console.warn('[commerce] adapter not available:', (err as Error).message);
    return null;
  }
}
