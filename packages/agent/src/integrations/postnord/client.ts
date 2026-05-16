import { env } from '../../env.ts';
import type { TrackingInfo } from '../../agent/types.ts';
import { mockTracking } from './mock.ts';

export interface PostNordClient {
  getTracking(trackingNumber: string): Promise<TrackingInfo | null>;
}

class MockPostNordClient implements PostNordClient {
  async getTracking(trackingNumber: string): Promise<TrackingInfo | null> {
    return mockTracking[trackingNumber] ?? null;
  }
}

class LivePostNordClient implements PostNordClient {
  async getTracking(_trackingNumber: string): Promise<TrackingInfo | null> {
    throw new Error('LivePostNordClient not implemented yet — set INTEGRATION_MODE=mock for now.');
  }
}

export function getPostNordClient(): PostNordClient {
  return env.integrationMode === 'live' ? new LivePostNordClient() : new MockPostNordClient();
}
