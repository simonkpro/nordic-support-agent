import { useRef } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { DefaultChatTransport, type UIMessage } from 'ai';

interface ChatRuntimeProps {
  apiUrl: string;
  widgetToken: string;
  conversationId: string;
  /**
   * Optional explicit assistant target. The server treats the token's
   * assistantId as authoritative when present; this body-level value is
   * a fallback used by the preview where we mint one shop-wide token and
   * pick the assistant at request time.
   */
  assistantId?: string;
  children: React.ReactNode;
}

/**
 * Wraps children in an assistant-ui runtime backed by /api/chat/stream.
 *
 * Bridges the two protocols:
 * - The AI SDK transport wants to send the full message list and pull a
 *   stream back.
 * - Our server only accepts {sessionId, message, assistantId?} and owns
 *   the canonical history. We use prepareSendMessagesRequest to extract
 *   the latest user message and inject the conversation id + assistant.
 */
export function ChatRuntimeProvider({
  apiUrl,
  widgetToken,
  conversationId,
  assistantId,
  children,
}: ChatRuntimeProps) {
  const transportRef = useRef<DefaultChatTransport<UIMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = new DefaultChatTransport<UIMessage>({
      api: apiUrl,
      headers: { Authorization: `Bearer ${widgetToken}` },
      prepareSendMessagesRequest: ({ messages, headers }) => {
        const last = [...messages].reverse().find((m) => m.role === 'user');
        const text = last
          ? last.parts
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('')
          : '';
        const body: Record<string, unknown> = { sessionId: conversationId, message: text };
        if (assistantId) body.assistantId = assistantId;
        return { headers, body };
      },
    });
  }

  const runtime = useChatRuntime({
    transport: transportRef.current,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
