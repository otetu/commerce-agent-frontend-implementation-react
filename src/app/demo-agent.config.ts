// Central demo transport configuration.
// This file defines the default mode, the live transport implementation choice,
// and the default converse endpoint used when live mode is enabled. Point the
// endpoint at your Coveo Commerce organization to go live.
export type DemoAgentMode = 'mock' | 'live';
export type DemoLiveTransport = 'custom-fetch' | 'ag-ui-client';

export const demoAgentConfig = {
  mode: 'mock' as DemoAgentMode,
  liveTransport: 'custom-fetch' as DemoLiveTransport,
  liveEndpoint:
    'https://platformdev.cloud.coveo.com/rest/organizations/commerceplaygrounducp0r4a2/commerce/unstable/agentic/converse',
  liveHeaders: {
    Authorization: 'Bearer your-token-here',
  },
  liveRequestDefaults: {
    trackingId: 'commerce_demo',
    language: 'en',
    country: 'US',
    currency: 'USD',
    clientId: '',
  },
};
