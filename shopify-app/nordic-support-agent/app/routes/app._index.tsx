import { useRef, useState, useEffect } from 'react';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { createConversation } from '../lib/conversations.ts';
import { loadTenantConfig } from '../lib/tenant-config.ts';
import { signWidgetToken } from '../lib/widget-token.ts';
import { AssistantModal } from '../components/assistant-ui/assistant-modal';
import { ChatRuntimeProvider } from '../components/assistant-ui/chat-runtime';

interface LoaderData {
  apiUrl: string;
  widgetToken: string;
  conversationId: string;
  agentName: string;
  shop: string;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const tenantConfig = await loadTenantConfig(session.shop);
  const convo = await createConversation(session.shop, {
    language: tenantConfig.language,
    country: tenantConfig.country,
    verifiedEmail: null,
  });
  const widgetToken = signWidgetToken(session.shop);
  const appUrl = process.env.SHOPIFY_APP_URL || '';
  return {
    apiUrl: appUrl ? `${appUrl}/api/chat/stream` : '/api/chat/stream',
    widgetToken,
    conversationId: convo.id,
    agentName: tenantConfig.agent.name,
    shop: session.shop,
  };
};

export default function Index() {
  const { apiUrl, widgetToken, conversationId, agentName, shop } =
    useLoaderData<typeof loader>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Force a re-render once the container ref is attached, so AssistantModal
  // can portal into it instead of document.body.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setContainer(containerRef.current);
  }, []);

  return (
    <s-page heading={`Test ${agentName}`}>
      <s-section heading="Try the agent">
        <s-paragraph>
          The chat below uses the same streaming endpoint
          (<s-text>/api/chat/stream</s-text>) and widget token your storefront customers
          will use. Token, conversation, brand color, and tone all come from your
          merchant settings.
        </s-paragraph>
        <s-paragraph>
          Mock orders available for testing: <s-text>#1001 (anna@example.se)</s-text>,
          <s-text> #1002 (erik@example.se)</s-text>, <s-text>#1003 (sara@example.se)</s-text>.
        </s-paragraph>

        <div
          ref={containerRef}
          style={{
            position: 'relative',
            height: 600,
            background: '#f3f4f6',
            borderRadius: 12,
            overflow: 'hidden',
            contain: 'layout',
          }}
        >
          {container && (
            <ChatRuntimeProvider
              apiUrl={apiUrl}
              widgetToken={widgetToken}
              conversationId={conversationId}
            >
              <AssistantModal container={container} defaultOpen />
            </ChatRuntimeProvider>
          )}
        </div>
      </s-section>

      <s-section slot="aside" heading="Pilot notes">
        <s-paragraph>
          Streaming via AI Gateway. Tokens render as the model produces them.
        </s-paragraph>
        <s-paragraph>
          Per-shop integrations active: <s-text>Live Shopify (this shop), Mock Klarna / PostNord</s-text>.
        </s-paragraph>
        <s-paragraph>Shop: <s-text>{shop}</s-text></s-paragraph>
        <s-paragraph>
          Edit name, tone, brand color, custom rules in{' '}
          <s-link href="/app/settings">Settings</s-link>.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
