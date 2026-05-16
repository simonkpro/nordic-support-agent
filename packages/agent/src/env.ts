/**
 * Reads env vars lazily so values reflect the *current* process.env at access
 * time — important when this module is imported as a library by a host (e.g.
 * the Shopify app) that loads its own .env before calling into the agent.
 *
 * No dotenv side-effect here. Entry points (CLI, eval runner) should load
 * dotenv themselves; library consumers manage their own env.
 */
function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const env = {
  get aiProvider(): 'gateway' | 'anthropic' | 'google' {
    const v = process.env.AI_PROVIDER;
    if (v === 'anthropic' || v === 'google') return v;
    return 'gateway';
  },
  get aiGatewayApiKey() {
    return process.env.AI_GATEWAY_API_KEY ?? '';
  },
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY ?? '';
  },
  get googleApiKey() {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  },
  get agentModel() {
    return process.env.AGENT_MODEL ?? 'anthropic/claude-sonnet-4-6';
  },
  get intentModel() {
    return process.env.AGENT_INTENT_MODEL ?? 'anthropic/claude-haiku-4-5';
  },
  get embeddingModel() {
    return process.env.EMBEDDING_MODEL ?? 'cohere/embed-v4.0';
  },
  get integrationMode(): 'mock' | 'live' {
    return (process.env.INTEGRATION_MODE ?? 'mock') as 'mock' | 'live';
  },
  shopify: {
    get shopDomain() {
      return process.env.SHOPIFY_SHOP_DOMAIN ?? '';
    },
    get adminToken() {
      return process.env.SHOPIFY_ADMIN_TOKEN ?? '';
    },
  },
  klarna: {
    get baseUrl() {
      return process.env.KLARNA_BASE_URL ?? 'https://api.playground.klarna.com';
    },
    get username() {
      return process.env.KLARNA_USERNAME ?? '';
    },
    get password() {
      return process.env.KLARNA_PASSWORD ?? '';
    },
  },
  postnord: {
    get apiKey() {
      return process.env.POSTNORD_API_KEY ?? '';
    },
  },
};

export function assertLiveCreds(provider: 'shopify' | 'klarna' | 'postnord'): void {
  if (env.integrationMode !== 'live') return;
  if (provider === 'shopify') {
    required('SHOPIFY_SHOP_DOMAIN');
    required('SHOPIFY_ADMIN_TOKEN');
  }
  if (provider === 'klarna') {
    required('KLARNA_USERNAME');
    required('KLARNA_PASSWORD');
  }
  if (provider === 'postnord') {
    required('POSTNORD_API_KEY');
  }
}
