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
import { loadTenantConfig } from '../lib/tenant-config.ts';

const RATE_LIMIT = { capacity: 20, refillPerMinute: 20 };
const ALLOWED_METHODS = 'POST, OPTIONS';

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type',
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

  const tenantConfig = await loadTenantConfig(shop);
  const promptContext: SystemPromptContext = {
    tenantName: shop.replace('.myshopify.com', ''),
    country: (convo.country as SystemPromptContext['country']) ?? tenantConfig.country,
    language: (convo.language as SystemPromptContext['language']) ?? tenantConfig.language,
    verifiedCustomerEmail: convo.verifiedEmail,
    agent: {
      name: tenantConfig.agent.name,
      tone: tenantConfig.agent.tone,
      customRules: tenantConfig.agent.customRules,
      signature: tenantConfig.agent.signature,
    },
  };

  const runtime: RuntimeContext = {
    conversationId: convo.id,
    verifiedEmail: convo.verifiedEmail,
    verificationStore: new PrismaVerificationStore(),
    emailSender: new ConsoleEmailSender(),
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

export const loader = () =>
  new Response(JSON.stringify({ error: 'POST only' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
