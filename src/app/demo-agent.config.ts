// Central demo transport configuration.
// This file defines the default mode, the live transport implementation choice,
// and the planned Freedom converse endpoint used when live mode is enabled.
export type DemoAgentMode = 'mock' | 'live';
export type DemoLiveTransport = 'custom-fetch' | 'ag-ui-client';

export const demoAgentConfig = {
  get logConversation() {
    return localStorage.getItem('logConversation') === 'true';
  },
  mode: 'mock' as DemoAgentMode,
  liveTransport: 'custom-fetch' as DemoLiveTransport,
  liveEndpoint:
    'https://platformdev.cloud.coveo.com/rest/organizations/commerceplaygrounducp0r4a2/commerce/unstable/agentic/converse',
  liveHeaders: {
    Authorization: 'Bearer your-token-here',
  },
  liveRequestDefaults: {
    trackingId: 'freedom',
    language: 'en',
    country: 'US',
    currency: 'USD',
    clientId: 'client-id',
  },
};
