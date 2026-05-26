import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { type ShopifyClient } from '../integrations/shopify/client.ts';
import { type KlarnaClient } from '../integrations/klarna/client.ts';
import { type PostNordClient } from '../integrations/postnord/client.ts';
import {
  ConsoleEmailSender,
  InMemoryVerificationStore,
  requestCode,
  verifyCode,
  type EmailSender,
  type VerificationStore,
} from './verification.ts';

export interface ToolCallRecord {
  name: string;
  input: unknown;
  output: unknown;
}

/**
 * Legacy commerce-client shape — kept for CLI/eval that hand-construct
 * mock clients. Production routes should inject the functional
 * `lookupOrder`/`lookupTracking`/`lookupRefund` adapters via RuntimeContext
 * instead. When both are present, RuntimeContext wins.
 */
export interface Integrations {
  shopify?: ShopifyClient;
  klarna?: KlarnaClient;
  postnord?: PostNordClient;
}

/**
 * Per-call runtime context. Threaded into tools so they can read the
 * conversation's current verification state and write verification codes.
 *
 * For library/eval/CLI use, leave it empty — defaults activate (in-memory
 * verification store, console-log email sender). For HTTP use, the route
 * passes the Prisma-backed store and a conversation ID so verification
 * persists across requests.
 */
export interface KnowledgeSearchResult {
  content: string;
  source: string;
  /** Public URL when the excerpt came from a crawled page (citable link). */
  sourceUrl?: string | null;
  score: number;
}

/**
 * Replace {placeholder} tokens in a merchant-supplied template with the
 * provided values. Unknown placeholders are left as-is so a merchant who
 * writes `{firstName}` in their template sees the literal token in the
 * email — easier to debug than silent emptiness.
 */
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] ?? '' : m));
}

export interface RuntimeContext {
  conversationId?: string;
  verifiedEmail?: string | null;
  verificationStore?: VerificationStore;
  emailSender?: EmailSender;
  /**
   * Per-shop knowledge-base search. When provided, the agent gets a
   * `search_knowledge_base` tool that calls this function. When omitted
   * (CLI, eval), the tool reports the knowledge base isn't configured.
   */
  knowledgeSearch?: (query: string) => Promise<KnowledgeSearchResult[]>;
  /**
   * Count of customer turns in the conversation so far (excluding the
   * current LLM reply being generated). Used to gate create_handoff_ticket
   * — the model can't escalate on a one-line first message.
   */
  userTurnCount?: number;
  /** Display name shown in handoff emails. */
  agentName?: string;
  /**
   * Configured destination + templates for handoff emails. Omit either
   * the sender or the destination and create_handoff_ticket will refuse
   * with a clear reason instead of silently dropping the escalation.
   */
  handoffSender?: HandoffSender;
  handoff?: {
    destinationEmail?: string;
    subjectTemplate?: string;
    bodyTemplate?: string;
  };
  /**
   * Identity-verification bar — per-merchant assistant config.
   *  0: no PII tools exposed. Knowledge base + handoff only.
   *  1: order# + email match. get_order returns status-only (no name,
   *     address, line item titles, payment specifics). No magic-link step.
   *  2: magic-link verification required before get_order, then full PII.
   * Default 1 — matches the order-status-page bar most merchants
   * already implicitly accept.
   */
  verificationTier?: 0 | 1 | 2;
  /**
   * Pluggable commerce backends. The agent doesn't know or care whether
   * the merchant runs Shopify, Centra, a bespoke API, or nothing at all
   * — the route wires in adapters. When a lookup is undefined, the
   * matching tool is not exposed (the model can still escalate via
   * create_handoff_ticket). Each lookup returns `null` when the order
   * cannot be found OR the email does not match — this is what the
   * tools use to enforce the Tier 1 "order# + email match" gate.
   */
  lookupOrder?: (orderNumber: string, email: string) => Promise<OrderSummary | null>;
  lookupTracking?: (orderNumber: string) => Promise<TrackingSummary | null>;
  lookupRefund?: (orderNumber: string) => Promise<RefundSummary | null>;
}

/** Status-only fields the agent is allowed to surface in Tier 1. */
export interface OrderSummary {
  number: string;
  currency: string;
  totalAmount: number;
  status: string;
  paymentProvider: string;
  createdAt: string;
  lineItemCount: number;
  /** Full PII shape — Tier 2 only. Tier 1 reads only the fields above. */
  full?: unknown;
}

export interface TrackingSummary {
  /** Opaque blob the model can format — let adapters decide the shape. */
  data: unknown;
}

export interface RefundSummary {
  data: unknown;
}

export interface HandoffPayload {
  /** Pre-rendered subject — placeholders already substituted. */
  subject: string;
  /** Pre-rendered body — placeholders already substituted. */
  body: string;
  to: string;
  reason: string;
  summary: string;
  conversationId: string;
  verifiedEmail: string | null;
  agentName: string;
}
export interface HandoffSendResult {
  ok: boolean;
  /** Provider-side message id when available (helps debug deliverability). */
  messageId?: string;
  error?: string;
}
export interface HandoffSender {
  send(payload: HandoffPayload): Promise<HandoffSendResult>;
}

export function buildTools(
  recorder: ToolCallRecord[],
  integrations: Integrations = {},
  runtime: RuntimeContext = {},
) {
  const conversationId = runtime.conversationId ?? 'cli-conversation';
  const verifiedEmail = runtime.verifiedEmail ?? null;
  const verificationStore = runtime.verificationStore ?? new InMemoryVerificationStore();
  const emailSender = runtime.emailSender ?? new ConsoleEmailSender();
  const knowledgeSearch = runtime.knowledgeSearch;
  const verificationTier = runtime.verificationTier ?? 1;

  // Commerce backends: prefer runtime adapters (route-injected
  // wrappers around Shopify/Centra/custom). Fall back to the legacy
  // Integrations shape — kept so CLI/eval and tests that pass mock
  // clients still work. No auto-instantiation: a tenant with no
  // backend wired sees the tool omitted (Tier 0/1) or returning
  // "not_configured" rather than mock data leaking into production.
  const shopify = integrations.shopify;
  const klarna = integrations.klarna;
  const postnord = integrations.postnord;
  const lookupOrder =
    runtime.lookupOrder ??
    (shopify
      ? async (n: string, e: string) => {
          const o = await shopify.getOrderByNumber(n, e);
          if (!o) return null;
          return {
            number: o.number,
            currency: o.currency,
            totalAmount: o.totalAmount,
            status: o.status,
            paymentProvider: o.paymentProvider,
            createdAt: o.createdAt,
            lineItemCount: o.lineItems.length,
            full: o,
          } satisfies OrderSummary;
        }
      : undefined);
  const lookupTracking =
    runtime.lookupTracking ??
    (shopify && postnord
      ? async (n: string) => {
          const num = await shopify.getTrackingNumber(n);
          if (!num) return null;
          const data = await postnord.getTracking(num);
          return { data } satisfies TrackingSummary;
        }
      : undefined);
  const lookupRefund =
    runtime.lookupRefund ??
    (klarna
      ? async (n: string) => {
          const data = await klarna.getRefundInfo(n);
          return { data } satisfies RefundSummary;
        }
      : undefined);

  const record = (name: string, input: unknown, output: unknown) => {
    recorder.push({ name, input, output });
    return output;
  };

  // Tier 1 variant of get_order: no magic-link verification required;
  // the order lookup itself enforces "email matches" via Shopify, then
  // we strip the response to status-only so the model never sees name,
  // address, line item titles, or payment details. Mirrors the bar of a
  // typical e-commerce order-status page.
  // Tier 1 variants for tracking + refund: take email + order_number,
  // re-validate ownership via Shopify before returning carrier/refund data.
  // Keeps the bar identical to get_order so a bot can't bypass by going
  // straight to tracking.
  const getTrackingTier1 = tool({
    description:
      "Look up carrier tracking for a customer's order. Pass the order number AND the email used at checkout — both must match a real order for the lookup to succeed.",
    inputSchema: z.object({
      order_number: z.string().describe('The order number'),
      email: z.string().email().describe('The email the customer used at checkout'),
    }),
    execute: async ({ order_number, email }) => {
      if (!lookupOrder || !lookupTracking) {
        return record('get_tracking', { order_number, email }, {
          tracking: null,
          reason: 'not_configured',
        });
      }
      const order = await lookupOrder(order_number, email);
      if (!order) {
        return record('get_tracking', { order_number, email }, {
          tracking: null,
          reason: 'not_found_or_email_mismatch',
        });
      }
      const tracking = await lookupTracking(order_number);
      if (!tracking) {
        return record('get_tracking', { order_number, email }, {
          tracking: null,
          reason: 'No tracking found — order has not shipped yet.',
        });
      }
      return record('get_tracking', { order_number, email }, { tracking: tracking.data });
    },
  });

  const getRefundInfoTier1 = tool({
    description:
      "Look up refund registration info for a customer's order. Pass the order number AND the email used at checkout — both must match. Where the payment provider is Klarna, this is the merchant-side registration only, NOT the consumer's bank settlement.",
    inputSchema: z.object({
      order_number: z.string().describe('The order number'),
      email: z.string().email().describe('The email the customer used at checkout'),
    }),
    execute: async ({ order_number, email }) => {
      if (!lookupOrder || !lookupRefund) {
        return record('get_refund_info', { order_number, email }, {
          refundInfo: null,
          reason: 'not_configured',
        });
      }
      const order = await lookupOrder(order_number, email);
      if (!order) {
        return record('get_refund_info', { order_number, email }, {
          refundInfo: null,
          reason: 'not_found_or_email_mismatch',
        });
      }
      const refund = await lookupRefund(order_number);
      return record('get_refund_info', { order_number, email }, { refundInfo: refund?.data ?? null });
    },
  });

  const getOrderTier1 = tool({
    description:
      'Look up an order status. Returns only status, currency, total, and item count — no customer name, no address, no line item details. Pass the order number and the email the customer says they used at checkout; the lookup will only succeed when both match.',
    inputSchema: z.object({
      order_number: z.string().describe('The order number, e.g. "#1001" or "1001"'),
      email: z.string().email().describe('The email the customer used at checkout'),
    }),
    execute: async ({ order_number, email }) => {
      if (!lookupOrder) {
        return record('get_order', { order_number, email }, {
          found: false,
          reason: 'not_configured',
          note:
            'Order lookup is not configured for this assistant. Escalate via create_handoff_ticket.',
        });
      }
      const order = await lookupOrder(order_number, email);
      if (!order) {
        return record('get_order', { order_number, email }, {
          found: false,
          reason: 'not_found_or_email_mismatch',
          note:
            'We could not find an order matching both that number and email. Ask the customer to double-check; do not say which one failed.',
        });
      }
      const stripped = {
        number: order.number,
        currency: order.currency,
        totalAmount: order.totalAmount,
        status: order.status,
        paymentProvider: order.paymentProvider,
        createdAt: order.createdAt,
        lineItemCount: order.lineItemCount,
      };
      return record('get_order', { order_number, email }, { found: true, order: stripped });
    },
  });

  const allTools = {
    request_verification_code: tool({
      description:
        'Send a 6-digit verification code to the customer\'s email. Required step-up before looking up any order data. Call this when you have the customer\'s email but the conversation is not yet verified for that email.',
      inputSchema: z.object({
        email: z
          .string()
          .email()
          .describe('The email address the customer says they used at checkout'),
      }),
      execute: async ({ email }) => {
        await requestCode(verificationStore, emailSender, conversationId, email);
        return record(
          'request_verification_code',
          { email },
          {
            sent: true,
            note: `A 6-digit code was sent to ${email}. Ask the customer to paste it back, then call verify_code.`,
          },
        );
      },
    }),

    verify_code: tool({
      description:
        'Verify a code the customer pasted from their email. On success, the conversation becomes bound to that verified email and order tools become usable.',
      inputSchema: z.object({
        code: z
          .string()
          .regex(/^\d{4,8}$/)
          .describe('The numeric code the customer received'),
      }),
      execute: async ({ code }) => {
        const outcome = await verifyCode(verificationStore, conversationId, code);
        if (outcome.ok) {
          return record('verify_code', { code: '[redacted]' }, {
            verified: true,
            email: outcome.email,
            note: 'Verification succeeded. You may now call get_order for this customer.',
          });
        }
        return record('verify_code', { code: '[redacted]' }, {
          verified: false,
          reason: outcome.reason,
          note:
            outcome.reason === 'wrong_code'
              ? 'Wrong code. The customer can try again, or you can request a new code.'
              : outcome.reason === 'expired'
                ? 'The code expired. Request a new one with request_verification_code.'
                : outcome.reason === 'too_many_attempts'
                  ? 'Too many wrong attempts. Request a new code if the customer is still present.'
                  : 'No pending code for this conversation. Call request_verification_code first.',
        });
      },
    }),

    get_order: tool({
      description:
        'Look up a verified customer\'s order. The conversation MUST already be verified for the provided email (via request_verification_code + verify_code). If not verified, this returns verification_required.',
      inputSchema: z.object({
        order_number: z.string().describe('The order number, e.g. "#1001" or "1001"'),
        email: z.string().email().describe('The verified email address'),
      }),
      execute: async ({ order_number, email }) => {
        if (!verifiedEmail || verifiedEmail.toLowerCase() !== email.toLowerCase()) {
          return record(
            'get_order',
            { order_number, email },
            {
              found: false,
              reason: 'verification_required',
              note:
                'The conversation is not yet verified for this email. Call request_verification_code(email) first, then ask the customer for the code, then verify_code(code).',
            },
          );
        }
        if (!lookupOrder) {
          return record('get_order', { order_number, email }, {
            found: false,
            reason: 'not_configured',
            note: 'Order lookup is not configured for this assistant.',
          });
        }
        const order = await lookupOrder(order_number, email);
        if (!order) {
          return record('get_order', { order_number, email }, {
            found: false,
            reason: 'Order not found or email does not match.',
          });
        }
        // Tier 2 may return the adapter's full payload when it provided
        // one; otherwise it gets the same status-only shape Tier 1 uses.
        return record('get_order', { order_number, email }, {
          found: true,
          order: order.full ?? order,
        });
      },
    }),

    get_tracking: tool({
      description:
        "Look up carrier tracking events for a verified customer's order. Only call after get_order has succeeded.",
      inputSchema: z.object({
        order_number: z.string().describe('The order number'),
      }),
      execute: async ({ order_number }) => {
        if (!verifiedEmail) {
          return record('get_tracking', { order_number }, {
            tracking: null,
            reason: 'verification_required',
          });
        }
        if (!lookupTracking) {
          return record('get_tracking', { order_number }, {
            tracking: null,
            reason: 'not_configured',
          });
        }
        const tracking = await lookupTracking(order_number);
        if (!tracking) {
          return record('get_tracking', { order_number }, {
            tracking: null,
            reason: 'No tracking found — order has not shipped yet.',
          });
        }
        return record('get_tracking', { order_number }, { tracking: tracking.data });
      },
    }),

    get_refund_info: tool({
      description:
        "Look up refund registration data for a verified customer's order. For Klarna, this is the merchant-side registration only, NOT the consumer's bank settlement.",
      inputSchema: z.object({
        order_number: z.string().describe('The order number'),
      }),
      execute: async ({ order_number }) => {
        if (!verifiedEmail) {
          return record('get_refund_info', { order_number }, {
            refundInfo: null,
            reason: 'verification_required',
          });
        }
        if (!lookupRefund) {
          return record('get_refund_info', { order_number }, {
            refundInfo: null,
            reason: 'not_configured',
          });
        }
        const refundInfo = (await lookupRefund(order_number))?.data ?? null;
        return record('get_refund_info', { order_number }, { refundInfo });
      },
    }),

    search_knowledge_base: tool({
      description:
        "Search the merchant's knowledge base for policies, FAQs, product info, sizing guides, shipping rules, return rules — anything documented but NOT in the live order / refund / tracking systems. Call this when the customer asks a general question about the store (not specific to an order). Returns the most relevant excerpts with their source document (filename) and, when the excerpt came from a crawled page, a sourceUrl you can include as a link. Quote or paraphrase the excerpts in your reply; do NOT make up details that aren't in the results. When a sourceUrl is present and the customer would benefit from reading more, include it as a markdown link in your reply.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .max(300)
          .describe('A natural-language search query in the customer\'s language.'),
      }),
      execute: async ({ query }) => {
        if (!knowledgeSearch) {
          return record('search_knowledge_base', { query }, {
            results: [],
            reason: 'knowledge_base_not_configured',
            note: 'The merchant has not uploaded any knowledge-base documents for this shop. Do not retry; tell the customer you don\'t have that information and offer to escalate.',
          });
        }
        const results = await knowledgeSearch(query);
        // Compute the unique citable URLs up front — we surface them as a
        // top-level array AND in a directive instruction so the model
        // cannot plausibly claim "no link is available". Pair each URL
        // with a human label (the document title / filename) so the model
        // can write meaningful link text.
        const citableSources: Array<{ label: string; url: string }> = [];
        const seenUrls = new Set<string>();
        for (const r of results) {
          if (r.sourceUrl && !seenUrls.has(r.sourceUrl)) {
            seenUrls.add(r.sourceUrl);
            citableSources.push({ label: r.source, url: r.sourceUrl });
          }
        }
        return record('search_knowledge_base', { query }, {
          results,
          count: results.length,
          citableSources,
          note:
            results.length === 0
              ? 'No relevant excerpts found in the knowledge base. Do not invent a link.'
              : citableSources.length > 0
                ? `Use these excerpts as the source of truth. The following pages are available as clickable sources — you MUST include at least one of them as a markdown link in your reply, written as [label](url). Never claim no link is available — these URLs ARE available:\n${citableSources.map((s) => `- [${s.label}](${s.url})`).join('\n')}`
                : 'Use these excerpts as the source of truth. No public URL is associated with these results; do not invent one.',
        });
      },
    }),

    create_handoff_ticket: tool({
      description:
        'Escalate the conversation to a human support agent by emailing the merchant\'s support inbox. Use when: the customer is angry, the question involves consumer-rights / legal disputes, the issue involves damaged goods over ~1000 SEK, a chargeback is mentioned, or you cannot answer with grounded data. NOTE: this tool will refuse if the conversation is too brief (one-line first messages) — gather order context, a clear description, and verify the customer first.',
      inputSchema: z.object({
        reason: z.enum([
          'angry_customer',
          'consumer_rights',
          'damaged_goods',
          'chargeback',
          'insufficient_data',
          'other',
        ]),
        summary: z
          .string()
          .describe(
            'A 1–3 sentence summary for the human agent including the customer issue, what you tried, and any order context.',
          ),
      }),
      execute: async ({ reason, summary }) => {
        const turns = runtime.userTurnCount ?? 0;
        const trimmedSummary = summary.trim();
        // Reasons that are inherently serious bypass the early-turn gate:
        // damaged_goods, chargebacks, and consumer_rights complaints are
        // legal/financial. Making the customer answer questionnaires for
        // these wastes the customer's time and frustrates them further.
        // The human reads the full thread either way.
        const seriousReason =
          reason === 'damaged_goods' ||
          reason === 'chargeback' ||
          reason === 'consumer_rights';
        // For everything else, allow when EITHER: the conversation has
        // run a few turns OR the agent has gathered a meaty summary AND
        // a verified identity.
        const enoughTurns = turns >= 3;
        const richContext = trimmedSummary.length >= 40 && Boolean(verifiedEmail);
        if (!seriousReason && !enoughTurns && !richContext) {
          return record('create_handoff_ticket', { reason, summary }, {
            ticket_created: false,
            reason_refused: 'too_early',
            note: `Escalation refused: the conversation is too short to escalate (${turns} customer turn(s), summary length ${trimmedSummary.length} chars, verified: ${Boolean(verifiedEmail)}). Before calling this tool again, ask the customer follow-up questions: what exactly happened, which product / order, when, and any photos. Only escalate once you have a clear description (40+ chars) AND a verified customer identity, OR after at least 3 customer turns. Do NOT tell the customer "I'm escalating" — just continue gathering info.`,
          });
        }

        const handoff = runtime.handoff ?? {};
        const destination = handoff.destinationEmail?.trim();
        const sender = runtime.handoffSender;
        if (!destination || !sender) {
          return record('create_handoff_ticket', { reason, summary }, {
            ticket_created: false,
            reason_refused: 'not_configured',
            note: 'Handoff email is not configured for this assistant. Tell the customer (politely) to email the merchant\'s general contact address directly, and do not pretend a ticket was created.',
          });
        }

        const agentName = runtime.agentName ?? 'Support';
        const subjectTpl = handoff.subjectTemplate?.trim() || '[Support] {reason}: {summary_short}';
        const bodyTpl =
          handoff.bodyTemplate?.trim() ||
          [
            'A customer support conversation has been escalated by {agentName}.',
            '',
            'Reason: {reason}',
            'Verified email: {verifiedEmail}',
            'Conversation id: {conversationId}',
            '',
            'Summary:',
            '{summary}',
          ].join('\n');

        const vars: Record<string, string> = {
          reason,
          summary: trimmedSummary,
          summary_short: trimmedSummary.slice(0, 80),
          agentName,
          conversationId,
          verifiedEmail: verifiedEmail ?? '(not verified)',
        };
        const subject = renderTemplate(subjectTpl, vars);
        const body = renderTemplate(bodyTpl, vars);

        const result = await sender.send({
          subject,
          body,
          to: destination,
          reason,
          summary: trimmedSummary,
          conversationId,
          verifiedEmail,
          agentName,
        });

        if (!result.ok) {
          return record('create_handoff_ticket', { reason, summary }, {
            ticket_created: false,
            reason_refused: 'send_failed',
            error: result.error ?? 'unknown',
            note: 'The escalation email could not be sent. Apologise, give the merchant\'s contact email if you know it, and ask the customer to write to support directly.',
          });
        }

        return record('create_handoff_ticket', { reason, summary }, {
          ticket_created: true,
          delivered_to: destination,
          message_id: result.messageId,
          reason,
          note: 'Escalation email delivered. Tell the customer briefly that a human will follow up — do not include the destination email or message id.',
        });
      },
    }),
  };

  // Filter exposed tools by both verificationTier (the policy) and which
  // backend adapters were actually injected (the capability). A tool
  // whose backend is missing is omitted entirely rather than exposed-
  // but-broken — the model would otherwise burn turns calling tools
  // that always return not_configured.
  // Each branch is cast to the AI SDK's ToolSet — input schemas vary
  // per tier so the inferred union would otherwise erase to `never`.
  if (verificationTier === 0) {
    return {
      search_knowledge_base: allTools.search_knowledge_base,
      create_handoff_ticket: allTools.create_handoff_ticket,
    } as unknown as ToolSet;
  }
  if (verificationTier === 1) {
    const tools: Record<string, unknown> = {
      search_knowledge_base: allTools.search_knowledge_base,
      create_handoff_ticket: allTools.create_handoff_ticket,
    };
    if (lookupOrder) tools.get_order = getOrderTier1;
    if (lookupOrder && lookupTracking) tools.get_tracking = getTrackingTier1;
    if (lookupOrder && lookupRefund) tools.get_refund_info = getRefundInfoTier1;
    return tools as unknown as ToolSet;
  }
  // Tier 2: same capability filtering, plus the verify-by-email pair.
  const tools: Record<string, unknown> = {
    request_verification_code: allTools.request_verification_code,
    verify_code: allTools.verify_code,
    search_knowledge_base: allTools.search_knowledge_base,
    create_handoff_ticket: allTools.create_handoff_ticket,
  };
  if (lookupOrder) tools.get_order = allTools.get_order;
  if (lookupTracking) tools.get_tracking = allTools.get_tracking;
  if (lookupRefund) tools.get_refund_info = allTools.get_refund_info;
  return tools as unknown as ToolSet;
}
