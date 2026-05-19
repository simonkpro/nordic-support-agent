import type { ActionFunctionArgs } from 'react-router';
import type { ModelMessage } from 'ai';
import {
  ConsoleEmailSender,
  LIMITS,
  LimitExceededError,
  streamAgent,
  type RuntimeContext,
  type SystemPromptContext,
} from '@nordic-support/agent';
import { getClientIp, takeToken } from '../lib/rate-limit.ts';
import {
  appendTurns,
  checkLimitsForNewMessage,
  createConversation,
  loadConversation,
  markConversationVerified,
  type StoredMessage,
} from '../lib/conversations.ts';
import { verifyWidgetToken } from '../lib/widget-token.ts';
import { PrismaVerificationStore } from '../lib/verification-store.ts';
import { getAssistant, loadOrCreateDefaultAssistant } from '../lib/assistants.ts';
import { searchKnowledge } from '../lib/knowledge.ts';
import { getHandoffSender } from '../lib/handoff-sender.ts';
import { isOriginAllowed } from '../lib/origin-allowlist.ts';
import { checkSpendCap, recordTokens } from '../lib/spend-cap.ts';

/**
 * Streaming chat endpoint. Emits the AI SDK UI message stream protocol so
 * clients (assistant-ui in the embedded admin; eventually the storefront
 * widget) can render the agent's response token-by-token.
 *
 *   POST /api/chat/stream
 *   Headers: Authorization: Bearer <widget token>
 *   Body: { sessionId?: string, message: string, context?: { language?, country? } }
 *   Response: text/event-stream — AI SDK UI message stream
 *
 * Same auth, rate-limit, body validation, and conversation persistence as
 * /api/chat (kept side-by-side so the existing vanilla widget keeps working).
 * Persistence runs in the agent's onFinish callback after the stream
 * completes.
 */
const RATE_LIMIT = { capacity: 20, refillPerMinute: 20 };
const ALLOWED_METHODS = 'POST, OPTIONS';

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // X-Conversation-Id is the canonical session id we set on streamed
    // responses; the widget needs JS access to it to persist resumption
    // across page loads. Browsers hide non-safelisted headers from
    // cross-origin JS unless we list them here.
    'Access-Control-Expose-Headers': 'X-Conversation-Id',
    Vary: 'Origin',
  };
}

interface ChatRequestBody {
  sessionId?: string;
  message: string;
  context?: Partial<SystemPromptContext>;
  /** Which assistant to chat with. Token's assistantId wins if both present. */
  assistantId?: string;
}

function isValidBody(value: unknown): value is ChatRequestBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.message !== 'string') return false;
  if (v.sessionId !== undefined && typeof v.sessionId !== 'string') return false;
  return true;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header);
  return match ? match[1]!.trim() : null;
}

function toModelMessages(stored: StoredMessage[]): ModelMessage[] {
  return stored.map((m) => ({ role: m.role, content: m.content })) as ModelMessage[];
}

function jsonError(status: number, body: unknown, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return jsonError(405, { error: 'method not allowed' }, cors);
  }

  const widgetToken = extractBearerToken(request);
  if (!widgetToken) {
    return jsonError(401, { error: 'missing_widget_token' }, cors);
  }
  const verified = verifyWidgetToken(widgetToken);
  if (!verified.ok || !verified.shop) {
    return jsonError(401, { error: 'invalid_widget_token', reason: verified.reason }, cors);
  }
  const shop = verified.shop;
  const tokenAssistantId = verified.assistantId;
  const tokenEpoch = verified.epoch;

  // Per-shop daily LLM spend cap. Same backstop as /api/chat.
  const spend = await checkSpendCap(shop);
  if (!spend.ok) {
    return jsonError(503, { error: 'spend_cap_reached', used: spend.used, cap: spend.cap }, cors);
  }

  const decision = takeToken(getClientIp(request), RATE_LIMIT);
  if (!decision.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds }),
      {
        status: 429,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Retry-After': String(decision.retryAfterSeconds),
        },
      },
    );
  }

  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (contentLength > 64 * 1024) {
    return jsonError(413, { error: 'request body too large' }, cors);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, { error: 'invalid json' }, cors);
  }
  if (!isValidBody(body)) {
    return jsonError(
      400,
      { error: 'expected { sessionId?: string, message: string, context? }' },
      cors,
    );
  }
  if (body.message.length > LIMITS.maxUserMessageChars) {
    return jsonError(
      400,
      {
        error: 'message_too_long',
        detail: `Max ${LIMITS.maxUserMessageChars} characters per message.`,
      },
      cors,
    );
  }

  let convo = body.sessionId ? await loadConversation(body.sessionId, shop) : null;
  if (!convo) {
    const requestedContext = body.context ?? {};
    convo = await createConversation(shop, {
      language: requestedContext.language ?? 'sv',
      country: requestedContext.country ?? 'SE',
      verifiedEmail: requestedContext.verifiedCustomerEmail ?? null,
    });
  }

  try {
    checkLimitsForNewMessage(convo.messages, body.message);
  } catch (err) {
    if (err instanceof LimitExceededError) {
      return jsonError(400, { error: err.code, detail: err.detail }, cors);
    }
    throw err;
  }

  const promptMessages: ModelMessage[] = [
    ...toModelMessages(convo.messages),
    { role: 'user', content: body.message } as ModelMessage,
  ];

  // Body can also carry an explicit assistantId (used by the preview which
  // mints one shop-wide token and picks at request time). Token > body —
  // a client can't override the assistant the token was issued for.
  const targetAssistantId = tokenAssistantId ?? body.assistantId;

  const assistant = targetAssistantId
    ? await getAssistant(targetAssistantId)
    : await loadOrCreateDefaultAssistant(shop);
  if (!assistant || assistant.shop !== shop) {
    return jsonError(404, { error: 'assistant_not_found' }, cors);
  }

  // Same revocation + origin checks as /api/chat. See that file for
  // commentary; keeping them here too so this route isn't a back door.
  if (tokenEpoch !== undefined ? tokenEpoch !== assistant.tokenEpoch : assistant.tokenEpoch > 1) {
    return jsonError(401, { error: 'token_revoked' }, cors);
  }
  if (
    !isOriginAllowed(
      request.headers.get('Origin'),
      request.headers.get('Referer'),
      assistant.config.widget.allowedOrigins,
    )
  ) {
    return jsonError(403, { error: 'origin_not_allowed' }, cors);
  }

  const promptContext: SystemPromptContext = {
    tenantName:
      assistant.config.business.companyName?.trim() ||
      shop.replace('.myshopify.com', ''),
    country: (convo.country as SystemPromptContext['country']) ?? assistant.config.country,
    language: (convo.language as SystemPromptContext['language']) ?? assistant.config.language,
    verifiedCustomerEmail: convo.verifiedEmail,
    business: {
      companyName: assistant.config.business.companyName,
      type: assistant.config.business.type,
      ecommerceProductTypes: assistant.config.business.ecommerceProductTypes,
      description: assistant.config.business.description,
      physicalLocations: assistant.config.business.physicalLocations,
      chatbotPurposes: assistant.config.business.chatbotPurposes,
    },
    agent: {
      name: assistant.config.agent.name,
      tone: assistant.config.agent.tone,
      customRules: assistant.config.agent.customRules,
      signature: assistant.config.agent.signature,
      fewShotExamples: assistant.config.agent.fewShotExamples,
    },
  };

  // Count customer turns so far (prior history + this incoming message).
  // The handoff tool uses this to refuse escalation on a one-line first
  // message — see RuntimeContext.userTurnCount in @nordic-support/agent.
  const priorUserTurns = convo.messages.filter((m) => m.role === 'user').length;
  const userTurnCount = priorUserTurns + 1;

  const runtime: RuntimeContext = {
    conversationId: convo.id,
    verifiedEmail: convo.verifiedEmail,
    verificationStore: new PrismaVerificationStore(),
    emailSender: new ConsoleEmailSender(),
    knowledgeSearch: async (q) => {
      const rows = await searchKnowledge(shop, assistant.id, q);
      return rows.map((r) => ({
        content: r.content,
        source: r.filename,
        sourceUrl: r.sourceUrl,
        score: r.score,
      }));
    },
    userTurnCount,
    agentName: assistant.config.agent.name,
    handoffSender: getHandoffSender(),
    handoff: {
      destinationEmail: assistant.config.agent.handoffEmail,
      subjectTemplate: assistant.config.agent.handoffSubjectTemplate,
      bodyTemplate: assistant.config.agent.handoffBodyTemplate,
    },
  };

  const conversationId = convo.id;
  const userMessage = body.message;

  try {
    const result = streamAgent({
      messages: promptMessages,
      context: promptContext,
      runtime,
      onFinish: async ({ text, toolCalls, totalTokens }) => {
        // Persist verification first so the next turn sees it.
        const verifySuccess = toolCalls.find(
          (c) =>
            c.name === 'verify_code' &&
            typeof c.output === 'object' &&
            c.output !== null &&
            (c.output as { verified?: boolean }).verified === true,
        );
        if (verifySuccess) {
          const email = (verifySuccess.output as { email?: string }).email;
          if (email) await markConversationVerified(conversationId, email);
        }
        await appendTurns(conversationId, userMessage, text);
        if (typeof totalTokens === 'number') {
          await recordTokens(shop, totalTokens);
        }
      },
    });

    // toUIMessageStreamResponse emits the AI SDK UI message stream protocol
    // that assistant-ui consumes natively. Pass through CORS + identify the
    // server-generated conversation id via a header for the client to pick up.
    const streamResponse = result.toUIMessageStreamResponse();
    const headers = new Headers(streamResponse.headers);
    for (const [k, v] of Object.entries(cors)) {
      headers.set(k, String(v));
    }
    headers.set('X-Conversation-Id', conversationId);
    return new Response(streamResponse.body, {
      status: streamResponse.status,
      headers,
    });
  } catch (err) {
    if (err instanceof LimitExceededError) {
      return jsonError(400, { error: err.code, detail: err.detail }, cors);
    }
    return jsonError(500, { error: (err as Error).message }, cors);
  }
};

// React Router routes OPTIONS to the loader. Without one, preflight from
// third-party origins (storefront widgets, test pages) 405s before the
// browser ever tries POSTing.
export const loader = ({ request }: { request: Request }) => {
  const cors = corsHeaders(request.headers.get('Origin'));
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  return new Response(JSON.stringify({ error: 'POST only' }), {
    status: 405,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
};
