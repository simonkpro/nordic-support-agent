import { tool } from 'ai';
import { z } from 'zod';
import { getShopifyClient, type ShopifyClient } from '../integrations/shopify/client.ts';
import { getKlarnaClient, type KlarnaClient } from '../integrations/klarna/client.ts';
import { getPostNordClient, type PostNordClient } from '../integrations/postnord/client.ts';
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
  const shopify = integrations.shopify ?? getShopifyClient();
  const klarna = integrations.klarna ?? getKlarnaClient();
  const postnord = integrations.postnord ?? getPostNordClient();
  const conversationId = runtime.conversationId ?? 'cli-conversation';
  const verifiedEmail = runtime.verifiedEmail ?? null;
  const verificationStore = runtime.verificationStore ?? new InMemoryVerificationStore();
  const emailSender = runtime.emailSender ?? new ConsoleEmailSender();
  const knowledgeSearch = runtime.knowledgeSearch;

  const record = (name: string, input: unknown, output: unknown) => {
    recorder.push({ name, input, output });
    return output;
  };

  return {
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
        const order = await shopify.getOrderByNumber(order_number, email);
        if (!order) {
          return record('get_order', { order_number, email }, {
            found: false,
            reason: 'Order not found or email does not match.',
          });
        }
        return record('get_order', { order_number, email }, { found: true, order });
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
        const trackingNumber = await shopify.getTrackingNumber(order_number);
        if (!trackingNumber) {
          return record('get_tracking', { order_number }, {
            tracking: null,
            reason: 'No tracking number found — order has not shipped yet.',
          });
        }
        const tracking = await postnord.getTracking(trackingNumber);
        return record('get_tracking', { order_number }, { tracking });
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
        const refundInfo = await klarna.getRefundInfo(order_number);
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
        // Allow when EITHER: the conversation has run a few turns already
        // OR the agent has gathered both a meaty summary AND a verified
        // identity (so we know who/what the ticket is about).
        const enoughTurns = turns >= 3;
        const richContext = trimmedSummary.length >= 40 && Boolean(verifiedEmail);
        if (!enoughTurns && !richContext) {
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
}
