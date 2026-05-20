import { generateText } from 'ai';
import { getModel } from '@nordic-support/agent/provider';
import { env } from '@nordic-support/agent/env';

/**
 * Cheap LLM classifier that buckets a conversation into one of nine
 * stable categories. Runs from the daily purge cron — never from a
 * chat-finalize hot path. The result is written to Conversation.category
 * and incremented onto ConversationDaily.categoryCounts.
 *
 * The category enum is intentionally tight (and stable) so a Nordic
 * dashboard can label them per business type without schema churn.
 * `returns` doubles as the "cancellation" intent for service businesses
 * — same downstream action (refund / undo a commitment).
 */

export const CATEGORY_KEYS = [
  'booking',
  'shipping',
  'returns',
  'product',
  'service_info',
  'pricing',
  'account',
  'complaint',
  'general',
  'other',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

const VALID = new Set<string>(CATEGORY_KEYS);

export interface CategorizeInput {
  /** First few user messages of the conversation, oldest first. We don't
   * need the full transcript — the intent shows up early. */
  userMessages: string[];
  /** Coarse business shape, drives the few-shot examples in the prompt. */
  businessType?: 'ecommerce' | 'service' | 'restaurant' | 'physical_retail' | 'other';
  /** Short merchant-supplied description, e.g. "Beauty clinic in
   * Stockholm, focus on laser treatments." Empty allowed. */
  businessDescription?: string;
  /** Conversation language (sv|en|no|da|fi), used only to keep the LLM
   * from flipping languages mid-classification. */
  language?: string;
}

const MAX_MESSAGES = 4;
const MAX_CHARS_PER_MESSAGE = 400;

/**
 * Classify a single conversation. Returns 'other' on any failure path so
 * the rollup never breaks because of categorization. Cost target: <=
 * $0.0005 per call using Haiku-tier model.
 */
export async function categorizeConversation(input: CategorizeInput): Promise<CategoryKey> {
  const sample = input.userMessages
    .slice(0, MAX_MESSAGES)
    .map((m) => (typeof m === 'string' ? m.slice(0, MAX_CHARS_PER_MESSAGE) : ''))
    .filter((s) => s.trim().length > 0);
  if (sample.length === 0) return 'other';

  const businessLine = buildBusinessLine(input.businessType, input.businessDescription);
  const system = [
    'You classify a customer-support conversation into exactly one category.',
    'Output ONLY the category key, nothing else. No explanation, no quotes.',
    '',
    'Categories:',
    '- booking — appointments, reservations, viewings, scheduling',
    '- shipping — order tracking, delivery times, where-is-my-order',
    '- returns — returns, refunds, exchanges, cancelling an appointment or order',
    '- product — products, sizing, materials, availability, stock',
    '- service_info — what services / treatments the business offers, how they work',
    '- pricing — prices, discounts, payment options, vouchers, deposits',
    '- account — login, password, profile, subscription, membership, tenant portal',
    '- complaint — damaged goods, dissatisfaction, anger, disputes',
    '- general — opening hours, location, brand, contact, small talk',
    '- other — anything that does not fit the above',
    '',
    businessLine,
    '',
    `Respond with exactly one of: ${CATEGORY_KEYS.join(', ')}`,
  ].join('\n');

  const userPrompt = sample.map((m, i) => `Message ${i + 1}: ${m}`).join('\n');

  try {
    const result = await generateText({
      model: getModel(env.intentModel),
      system,
      prompt: userPrompt,
      temperature: 0,
      maxOutputTokens: 8,
    });
    const raw = (result.text ?? '').trim().toLowerCase();
    // Models sometimes wrap or punctuate; pull the first valid token.
    const match = raw.match(/[a-z_]+/);
    const candidate = match ? match[0] : raw;
    if (VALID.has(candidate)) return candidate as CategoryKey;
    return 'other';
  } catch (err) {
    console.warn('[categorize] failed:', (err as Error).message);
    return 'other';
  }
}

function buildBusinessLine(
  type: CategorizeInput['businessType'],
  description: string | undefined,
): string {
  const head = (() => {
    switch (type) {
      case 'ecommerce':
        return 'The business is an e-commerce store. Expect shipping / returns / product questions to dominate.';
      case 'service':
        return 'The business sells services (e.g. clinic, dental, consultancy). Expect bookings, service info, and aftercare-like questions; "returns" maps to cancellations.';
      case 'restaurant':
        return 'The business is a restaurant. Expect booking, hours, menu, and pricing questions.';
      case 'physical_retail':
        return 'The business is a physical retail store. Expect product, hours, and pricing questions.';
      case 'other':
      default:
        return 'The business type is mixed or unspecified. Use the message content to decide.';
    }
  })();
  const desc = (description ?? '').trim();
  return desc ? `${head}\nMerchant description: ${desc.slice(0, 400)}` : head;
}
