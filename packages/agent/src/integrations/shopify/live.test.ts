import { describe, expect, it } from 'vitest';

import {
  mapOrder,
  mapStatus,
  safeEmailForSearch,
  safeOrderNameForSearch,
  toMinorUnits,
} from './live.ts';

describe('safeOrderNameForSearch', () => {
  it('accepts normal order numbers and quotes them', () => {
    expect(safeOrderNameForSearch('#1001')).toBe('"#1001"');
  });
  it('rejects injection via OR', () => {
    expect(() => safeOrderNameForSearch('#1001 OR email:*')).toThrow();
  });
  it('rejects unquoted with spaces', () => {
    expect(() => safeOrderNameForSearch('1001')).toThrow();
  });
  it('rejects double quotes', () => {
    expect(() => safeOrderNameForSearch('#1001"')).toThrow();
  });
  it('rejects field-prefix injection', () => {
    expect(() => safeOrderNameForSearch('#1001 name:#1002')).toThrow();
  });
});

describe('safeEmailForSearch', () => {
  it('accepts normal emails and quotes them', () => {
    expect(safeEmailForSearch('anna@example.se')).toBe('"anna@example.se"');
  });
  it('rejects emails with OR injection', () => {
    expect(() => safeEmailForSearch('anna@example.se OR email:erik@example.se')).toThrow();
  });
  it('rejects quotes', () => {
    expect(() => safeEmailForSearch('anna"@example.se')).toThrow();
  });
  it('rejects wildcards', () => {
    expect(() => safeEmailForSearch('*@example.se')).toThrow();
  });
  it('rejects field prefix in value', () => {
    expect(() => safeEmailForSearch('anna@example.se email:*')).toThrow();
  });
  it('rejects backslash', () => {
    expect(() => safeEmailForSearch('anna\\@example.se')).toThrow();
  });
});

describe('toMinorUnits', () => {
  it('converts whole decimal strings', () => {
    expect(toMinorUnits('1299.00')).toBe(129900);
    expect(toMinorUnits('0.50')).toBe(50);
    expect(toMinorUnits('100')).toBe(10000);
  });
  it('handles missing/short fractions', () => {
    expect(toMinorUnits('5.5')).toBe(550);
    expect(toMinorUnits('5')).toBe(500);
  });
});

describe('mapStatus', () => {
  it('refunded beats fulfilled', () => {
    expect(mapStatus('REFUNDED', 'FULFILLED')).toBe('refunded');
    expect(mapStatus('PARTIALLY_REFUNDED', 'FULFILLED')).toBe('partially_refunded');
  });
  it('voided -> cancelled', () => {
    expect(mapStatus('VOIDED', null)).toBe('cancelled');
  });
  it('fulfilled when not refunded', () => {
    expect(mapStatus('PAID', 'FULFILLED')).toBe('fulfilled');
  });
  it('paid but not fulfilled', () => {
    expect(mapStatus('PAID', 'UNFULFILLED')).toBe('paid');
  });
  it('falls back to open', () => {
    expect(mapStatus(null, null)).toBe('open');
  });
});

describe('mapOrder', () => {
  it('maps a typical Shopify order shape', () => {
    const node = {
      id: 'gid://shopify/Order/1001',
      name: '#1001',
      email: 'anna@example.se',
      customer: { firstName: 'Anna', lastName: 'Lindberg' },
      currencyCode: 'SEK',
      totalPriceSet: { shopMoney: { amount: '1299.00', currencyCode: 'SEK' } },
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'FULFILLED',
      createdAt: '2026-05-08T09:14:22Z',
      shippingAddress: {
        name: 'Anna Lindberg',
        address1: 'Kungsgatan 12',
        address2: null,
        zip: '11135',
        city: 'Stockholm',
        countryCodeV2: 'SE',
      },
      lineItems: {
        edges: [
          {
            node: {
              id: 'li_1',
              sku: 'KNIT-OAT-M',
              title: 'Merino Knit Sweater',
              quantity: 1,
              refundableQuantity: 1,
              originalUnitPriceSet: { shopMoney: { amount: '1299.00', currencyCode: 'SEK' } },
            },
          },
        ],
      },
      fulfillments: [],
    };
    const order = mapOrder(node);
    expect(order.number).toBe('#1001');
    expect(order.customerEmail).toBe('anna@example.se');
    expect(order.customerName).toBe('Anna Lindberg');
    expect(order.totalAmount).toBe(129900);
    expect(order.status).toBe('fulfilled');
    expect(order.shippingAddress?.country).toBe('SE');
    expect(order.lineItems[0]?.refundedQuantity).toBe(0);
  });

  it('marks line items as refunded when refundableQuantity < quantity', () => {
    const node = {
      id: 'gid://shopify/Order/1002',
      name: '#1002',
      email: 'erik@example.se',
      customer: { firstName: 'Erik', lastName: 'Svensson' },
      currencyCode: 'SEK',
      totalPriceSet: { shopMoney: { amount: '1198.00', currencyCode: 'SEK' } },
      displayFinancialStatus: 'PARTIALLY_REFUNDED',
      displayFulfillmentStatus: 'FULFILLED',
      createdAt: '2026-05-02T14:02:10Z',
      shippingAddress: null,
      lineItems: {
        edges: [
          {
            node: {
              id: 'li_2a',
              sku: 'TEE-BLK-L',
              title: 'Heavy Cotton Tee',
              quantity: 2,
              refundableQuantity: 1,
              originalUnitPriceSet: { shopMoney: { amount: '599.00', currencyCode: 'SEK' } },
            },
          },
        ],
      },
      fulfillments: [],
    };
    const order = mapOrder(node);
    expect(order.status).toBe('partially_refunded');
    expect(order.lineItems[0]?.refundedQuantity).toBe(1);
    expect(order.shippingAddress).toBeNull();
  });

  it('drops shippingAddress for non-Nordic countries', () => {
    const node = {
      id: 'gid://shopify/Order/2000',
      name: '#2000',
      email: 'tom@example.com',
      customer: null,
      currencyCode: 'USD',
      totalPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'USD' } },
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'UNFULFILLED',
      createdAt: '2026-05-10T00:00:00Z',
      shippingAddress: {
        name: null,
        address1: '1 Main',
        address2: null,
        zip: '10001',
        city: 'New York',
        countryCodeV2: 'US',
      },
      lineItems: { edges: [] },
      fulfillments: [],
    };
    const order = mapOrder(node);
    expect(order.shippingAddress).toBeNull();
    expect(order.status).toBe('paid');
  });
});
