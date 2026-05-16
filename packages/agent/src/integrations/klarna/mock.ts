import type { RefundInfo } from '../../agent/types.ts';

export const mockRefunds: Record<string, RefundInfo> = {
  '#1002': {
    orderId: '#1002',
    provider: 'klarna',
    totalRefundedAmount: 599_00,
    currency: 'SEK',
    lifecycleSupported: false,
    refunds: [
      {
        id: 'rf_klarna_aaa111',
        amount: 599_00,
        createdAt: '2026-05-10T08:30:00Z',
        status: 'registered',
        description: 'Return: 1x Heavy Cotton Tee (Black, L)',
      },
    ],
  },
  '#1001': {
    orderId: '#1001',
    provider: 'klarna',
    totalRefundedAmount: 0,
    currency: 'SEK',
    lifecycleSupported: false,
    refunds: [],
  },
  '#1003': {
    orderId: '#1003',
    provider: 'klarna',
    totalRefundedAmount: 0,
    currency: 'SEK',
    lifecycleSupported: false,
    refunds: [],
  },
};
