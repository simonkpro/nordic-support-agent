import { env } from '../../env.ts';
import type { RefundInfo } from '../../agent/types.ts';
import { mockRefunds } from './mock.ts';

export interface KlarnaClient {
  getRefundInfo(orderId: string): Promise<RefundInfo | null>;
}

class MockKlarnaClient implements KlarnaClient {
  async getRefundInfo(orderId: string): Promise<RefundInfo | null> {
    const key = orderId.startsWith('#') ? orderId : `#${orderId}`;
    return mockRefunds[key] ?? null;
  }
}

class LiveKlarnaClient implements KlarnaClient {
  async getRefundInfo(_orderId: string): Promise<RefundInfo | null> {
    throw new Error('LiveKlarnaClient not implemented yet — set INTEGRATION_MODE=mock for now.');
  }
}

export function getKlarnaClient(): KlarnaClient {
  return env.integrationMode === 'live' ? new LiveKlarnaClient() : new MockKlarnaClient();
}
