import { useEffect, useRef, useState } from 'react';
import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { createConversation } from '../lib/conversations.ts';
import { signWidgetToken } from '../lib/widget-token.ts';
import { AssistantModal } from '../components/assistant-ui/assistant-modal';
import { ChatRuntimeProvider } from '../components/assistant-ui/chat-runtime';

/**
 * Standalone preview of the assistant-ui chat modal. NOT auth-gated —
 * convenient for visual verification without a Shopify admin session.
 * Generates a real widget token for a placeholder shop so the auth path
 * actually runs (you'll still need AI Gateway credits to see streamed
 * replies, but the UI + auth + persistence all work).
 *
 * Do not deploy this route to production. Strip it before shipping.
 */
const PREVIEW_SHOP = 'preview-shop.myshopify.com';

interface LoaderData {
  widgetToken: string;
  conversationId: string;
}

export const loader = async (_args: LoaderFunctionArgs): Promise<LoaderData> => {
  const convo = await createConversation(PREVIEW_SHOP, {
    language: 'sv',
    country: 'SE',
    verifiedEmail: null,
  });
  return {
    widgetToken: signWidgetToken(PREVIEW_SHOP),
    conversationId: convo.id,
  };
};

export default function Preview() {
  const { widgetToken, conversationId } = useLoaderData<typeof loader>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setContainer(containerRef.current);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        padding: 40,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto 24px',
          background: 'white',
          padding: 24,
          borderRadius: 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22 }}>assistant-ui preview</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
          The chat below uses /api/chat/stream with a signed widget token. Click the bot
          bubble bottom-right of the dark container to open the modal. Streams token-by-token
          when AI Gateway has credits; otherwise you'll see an error chunk.
        </p>
        <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 8 }}>
          conversationId: <code>{conversationId.slice(0, 8)}…</code>
        </p>
      </div>

      <div
        ref={containerRef}
        style={{
          maxWidth: 720,
          margin: '0 auto',
          position: 'relative',
          height: 600,
          background: 'white',
          borderRadius: 12,
          overflow: 'hidden',
          contain: 'layout',
          border: '1px solid #e5e7eb',
        }}
      >
        {container && (
          <ChatRuntimeProvider
            apiUrl="/api/chat/stream"
            widgetToken={widgetToken}
            conversationId={conversationId}
          >
            <AssistantModal container={container} defaultOpen />
          </ChatRuntimeProvider>
        )}
      </div>
    </div>
  );
}
