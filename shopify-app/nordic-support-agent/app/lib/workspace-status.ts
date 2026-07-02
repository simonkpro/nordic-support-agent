import prisma from '../db.server';

/**
 * True if the standalone workspace that owns this `shop` is suspended.
 *
 * `shop` is a workspace UUID for standalone tenants and a myshopify domain
 * for Shopify tenants. Only standalone tenants have a Workspace row, so a
 * Shopify shop (no matching row) is never "suspended" by this mechanism —
 * that path is governed by the Shopify app install state instead.
 *
 * Used on the public widget surface (token issuance + chat) so that
 * disabling a client in /admin actually stops their widget, not just the
 * already-issued tokens. Without this a suspended client's assistant is
 * still `published`, so the public-token endpoint would happily mint a
 * fresh token carrying the bumped epoch and the widget keeps running.
 */
export async function isShopSuspended(shop: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({
    where: { id: shop },
    select: { disabledAt: true },
  });
  return ws?.disabledAt != null;
}
