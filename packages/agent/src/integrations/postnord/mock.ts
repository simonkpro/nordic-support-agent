import type { TrackingInfo } from '../../agent/types.ts';

export const mockTracking: Record<string, TrackingInfo> = {
  PN1234567890SE: {
    trackingNumber: 'PN1234567890SE',
    carrier: 'PostNord',
    status: 'delivered',
    statusUpdatedAt: '2026-05-12T16:42:00Z',
    estimatedDelivery: '2026-05-12',
    pickupPointName: 'PostNord Ombud — Pressbyrån Kungsgatan',
    events: [
      {
        at: '2026-05-09T11:02:00Z',
        status: 'pre_transit',
        description: 'Sändning registrerad',
        location: 'Stockholm',
      },
      {
        at: '2026-05-10T22:14:00Z',
        status: 'in_transit',
        description: 'På väg mot utlämningsställe',
        location: 'Rosersberg',
      },
      {
        at: '2026-05-11T09:50:00Z',
        status: 'at_pickup_point',
        description: 'Tillgänglig för upphämtning hos ombud',
        location: 'Pressbyrån Kungsgatan, Stockholm',
      },
      {
        at: '2026-05-12T16:42:00Z',
        status: 'delivered',
        description: 'Upphämtad av mottagare',
        location: 'Pressbyrån Kungsgatan, Stockholm',
      },
    ],
  },
  PN9876543210SE: {
    trackingNumber: 'PN9876543210SE',
    carrier: 'PostNord',
    status: 'in_transit',
    statusUpdatedAt: '2026-05-14T07:18:00Z',
    estimatedDelivery: '2026-05-16',
    pickupPointName: null,
    events: [
      {
        at: '2026-05-13T14:30:00Z',
        status: 'pre_transit',
        description: 'Sändning registrerad',
        location: 'Göteborg',
      },
      {
        at: '2026-05-14T07:18:00Z',
        status: 'in_transit',
        description: 'Sorteringsterminal',
        location: 'Göteborg',
      },
    ],
  },
};
