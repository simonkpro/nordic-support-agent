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
export interface RuntimeContext {
  conversationId?: string;
  verifiedEmail?: string | null;
  verificationStore?: VerificationStore;
  emailSender?: EmailSender;
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

    create_handoff_ticket: tool({
      description:
        'Escalate the conversation to a human support agent. Use when: the customer is angry, the question involves consumer-rights / legal disputes, the issue involves damaged goods over ~1000 SEK, a chargeback is mentioned, or you cannot answer with grounded data.',
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
        return record('create_handoff_ticket', { reason, summary }, {
          ticket_created: true,
          ticket_id: `mock_ticket_${Date.now()}`,
          reason,
        });
      },
    }),
  };
}
