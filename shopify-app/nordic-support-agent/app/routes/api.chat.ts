import type { ActionFunctionArgs } from 'react-router';
import { runAgent, LIMITS, LimitExceededError } from '@nordic-support/agent/run';
import type { ModelMessage } from 'ai';
import {
  ConsoleEmailSender,
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

const RATE_LIMIT = { capacity: 20, refillPerMinute: 20 };
const ALLOWED_METHODS = 'POST, OPTIONS';

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

interface ChatRequestBody {
  /** Existing conversation ID. Omit on the first message to start a new conversation. */
  sessionId?: string;
  /** Single new user message. Server-side history is the source of truth. */
  message: string;
  /** Optional per-conversation context (only used when creating a new conversation). */
  context?: Partial<SystemPromptContext>;
  /** Which assistant to chat with. Token's assistantId wins if both are present. */
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const widgetToken = extractBearerToken(request);
  if (!widgetToken) {
    return new Response(
      JSON.stringify({ error: 'missing_widget_token' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
  const verified = verifyWidgetToken(widgetToken);
  if (!verified.ok || !verified.shop) {
    return new Response(
      JSON.stringify({ error: 'invalid_widget_token', reason: verified.reason }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
  const shop = verified.shop;
  const tokenAssistantId = verified.assistantId;
  const tokenEpoch = verified.epoch;

  // Per-shop daily LLM spend cap. Cheap to check, expensive to skip —
  // an IP-rotating attacker would otherwise burn the merchant's budget.
  const spend = await checkSpendCap(shop);
  if (!spend.ok) {
    return new Response(
      JSON.stringify({ error: 'spend_cap_reached', used: spend.used, cap: spend.cap }),
      { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
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
  const MAX_BODY_BYTES = 64 * 1024;
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'request body too large' }), {
      status: 413,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!isValidBody(body)) {
    return new Response(
      JSON.stringify({
        error: 'expected { sessionId?: string, message: string, context? }',
      }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  if (body.message.length > LIMITS.maxUserMessageChars) {
    return new Response(
      JSON.stringify({
        error: 'message_too_long',
        detail: `Max ${LIMITS.maxUserMessageChars} characters per message.`,
      }),
      { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // Load existing conversation (canonical history) or create a new one.
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
      return new Response(
        JSON.stringify({ error: err.code, detail: err.detail }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    throw err;
  }

  const promptMessages: ModelMessage[] = [
    ...toModelMessages(convo.messages),
    { role: 'user', content: body.message } as ModelMessage,
  ];

  // Same routing as /api/chat/stream: token's assistant > body's > shop default.
  const targetAssistantId = tokenAssistantId ?? body.assistantId;
  const assistant = targetAssistantId
    ? await getAssistant(targetAssistantId)
    : await loadOrCreateDefaultAssistant(shop);
  if (!assistant || assistant.shop !== shop) {
    return new Response(JSON.stringify({ error: 'assistant_not_found' }), {
      status: 404,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Token revocation check. If the token carries an epoch, it must match
  // the assistant's current tokenEpoch. Legacy tokens (no epoch) are
  // accepted unless the assistant has been bumped past 1 — once revoked,
  // any token without an epoch is also invalid.
  if (tokenEpoch !== undefined ? tokenEpoch !== assistant.tokenEpoch : assistant.tokenEpoch > 1) {
    return new Response(
      JSON.stringify({ error: 'token_revoked' }),
      { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }

  // Origin allowlist (if configured for this assistant).
  if (
    !isOriginAllowed(
      request.headers.get('Origin'),
      request.headers.get('Referer'),
      assistant.config.widget.allowedOrigins,
    )
  ) {
    return new Response(
      JSON.stringify({ error: 'origin_not_allowed' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
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

  const priorUserTurns = convo.messages.filter((m) => m.role === 'user').length;

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
    userTurnCount: priorUserTurns + 1,
    agentName: assistant.config.agent.name,
    handoffSender: getHandoffSender(),
    handoff: {
      destinationEmail: assistant.config.agent.handoffEmail,
      subjectTemplate: assistant.config.agent.handoffSubjectTemplate,
      bodyTemplate: assistant.config.agent.handoffBodyTemplate,
    },
  };

  try {
    const result = await runAgent({
      messages: promptMessages,
      context: promptContext,
      runtime,
    });
    // If the agent successfully completed verification in this turn, persist
    // the verified email on the conversation so future turns skip the dance.
    const verifySuccess = result.toolCalls.find(
      (c) =>
        c.name === 'verify_code' &&
        typeof c.output === 'object' &&
        c.output !== null &&
        (c.output as { verified?: boolean }).verified === true,
    );
    if (verifySuccess) {
      const email = (verifySuccess.output as { email?: string }).email;
      if (email) await markConversationVerified(convo.id, email);
    }
    await appendTurns(convo.id, body.message, result.text);
    if (typeof result.totalTokens === 'number') {
      await recordTokens(shop, result.totalTokens);
    }
    return new Response(
      JSON.stringify({
        sessionId: convo.id,
        reply: result.text,
        toolCalls: result.toolCalls.map((c) => c.name),
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    if (err instanceof LimitExceededError) {
      return new Response(
        JSON.stringify({ error: err.code, detail: err.detail }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
};

// React Router routes OPTIONS (and any other non-mutating method) to the
// loader, not the action. Handle CORS preflight here so cross-origin
// widgets on third-party sites work.
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
