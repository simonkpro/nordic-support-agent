import { z } from 'zod';
import prisma from '../db.server';

/**
 * Per-merchant assistant. A shop has many; each is a separate persona /
 * tone / brand / language config. Customers reach one at a time — either
 * the default (no specific id supplied) or the one named in the widget
 * token / API request.
 *
 * Config storage is JSON-text inside the Assistant table (same pattern
 * we used for the old TenantConfig). Validation lives in this module.
 */

export const FewShotExampleSchema = z.object({
  user: z.string().min(1).max(500),
  assistant: z.string().min(1).max(1000),
});

export type FewShotExample = z.infer<typeof FewShotExampleSchema>;

// === Step 1: Business information (Företagsinformation) ===========
// What the agent should know about the merchant. Drives the "About"
// section of the system prompt + answers to questions about hours,
// locations, what the business actually does.

export const PhysicalLocationSchema = z.object({
  name: z.string().min(1).max(80),
  address: z.string().max(280).default(''),
  hours: z.string().max(280).default(''),
  bookingRequired: z.boolean().default(false),
  notes: z.string().max(280).default(''),
});

export type PhysicalLocation = z.infer<typeof PhysicalLocationSchema>;

export const BusinessTypeEnum = z.enum([
  'ecommerce',
  'service',
  'restaurant',
  'physical_retail',
  'other',
]);
export type BusinessType = z.infer<typeof BusinessTypeEnum>;

export const ChatbotPurposeEnum = z.enum([
  'business_questions',
  'order_status',
  'returns',
  'shipping',
  'product_info',
  'bookings',
  'general_support',
]);
export type ChatbotPurpose = z.infer<typeof ChatbotPurposeEnum>;

export const AssistantConfigSchema = z.object({
  business: z.object({
    companyName: z.string().max(80).default(''),
    type: BusinessTypeEnum.default('ecommerce'),
    // Only meaningful when type === 'ecommerce'. Free text so the agent
    // can describe naturally: "merino sweaters, accessories, gift cards".
    ecommerceProductTypes: z.string().max(280).default(''),
    description: z.string().max(1500).default(''),
    physicalLocations: z.array(PhysicalLocationSchema).max(10).default([]),
    // What the agent is responsible for. Surfaces in the system prompt
    // so the model knows what to engage with vs. politely escalate.
    chatbotPurposes: z
      .array(ChatbotPurposeEnum)
      .default(['business_questions', 'general_support']),
  }),
  // === Step 2: Customize agent (Skräddarsy agent) ==================
  agent: z.object({
    name: z.string().min(1).max(40).default('Support'),
    tone: z.enum(['friendly', 'professional', 'casual']).default('friendly'),
    greeting: z.string().max(280).default(''),
    signature: z.string().max(120).default(''),
    customRules: z.string().max(2000).default(''),
    fewShotExamples: z.array(FewShotExampleSchema).max(5).default([]),
    /**
     * Phrases shown while the agent is generating a reply. The widget
     * cycles through these every couple seconds — gives the chat character
     * and avoids the static "Thinking…" feel. Up to 15.
     */
    thinkingVerbs: z
      .array(z.string().min(1).max(40))
      .max(15)
      .default([
        'Funderar',
        'Tänker',
        'Söker upp',
        'Letar upp dokument',
        'Knåpar',
        'Tar mig en funderare',
        'Dubbelkollar',
      ]),
    /**
     * Phrases shown when something goes wrong. Each is paired with the
     * scenario that triggers it; merchant edits the copy, not the code.
     * Empty strings fall back to the locale defaults baked into the widget.
     */
    errorPhrases: z
      .object({
        generic: z.string().max(200).default(''),
        network: z.string().max(200).default(''),
        rateLimit: z.string().max(200).default(''),
        tooLong: z.string().max(200).default(''),
        tooManyTurns: z.string().max(200).default(''),
        unconfigured: z.string().max(200).default(''),
      })
      .default({}),
  }),
  language: z.enum(['sv', 'en', 'no', 'da', 'fi']).default('sv'),
  country: z.enum(['SE', 'NO', 'DK', 'FI']).default('SE'),
  // === Step 3: Customize widget (Skräddarsy chattruta) =============
  widget: z.object({
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .default('#1f2937'),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .default('#1f2937'),
    iconStyle: z.enum(['bot', 'chat_bubble', 'sparkle', 'help']).default('bot'),
    width: z.number().int().min(300).max(600).default(400),
    height: z.number().int().min(400).max(800).default(540),
  }),
});

export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

export interface AssistantRecord {
  id: string;
  shop: string;
  name: string;
  isDefault: boolean;
  config: AssistantConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicAssistantConfig {
  id: string;
  widget: AssistantConfig['widget'];
  language: AssistantConfig['language'];
  country: AssistantConfig['country'];
  agent: {
    name: string;
    greeting: string;
    thinkingVerbs: string[];
    errorPhrases: AssistantConfig['agent']['errorPhrases'];
  };
}

export function toPublicConfig(a: AssistantRecord): PublicAssistantConfig {
  return {
    id: a.id,
    widget: a.config.widget,
    language: a.config.language,
    country: a.config.country,
    agent: {
      name: a.config.agent.name,
      greeting: a.config.agent.greeting,
      thinkingVerbs: a.config.agent.thinkingVerbs,
      errorPhrases: a.config.agent.errorPhrases,
    },
  };
}

const DEFAULT_CONFIG = AssistantConfigSchema.parse({
  business: {},
  agent: {},
  widget: {},
});

export function defaultConfig(): AssistantConfig {
  return DEFAULT_CONFIG;
}

function parseRow(row: {
  id: string;
  shop: string;
  name: string;
  isDefault: boolean;
  config: string;
  createdAt: Date;
  updatedAt: Date;
}): AssistantRecord {
  let config: AssistantConfig;
  try {
    config = AssistantConfigSchema.parse(JSON.parse(row.config));
  } catch (err) {
    console.warn('[assistants] invalid stored config for', row.id, err);
    config = defaultConfig();
  }
  return {
    id: row.id,
    shop: row.shop,
    name: row.name,
    isDefault: row.isDefault,
    config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAssistants(shop: string): Promise<AssistantRecord[]> {
  const rows = await prisma.assistant.findMany({
    where: { shop },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map(parseRow);
}

export async function getAssistant(id: string): Promise<AssistantRecord | null> {
  const row = await prisma.assistant.findUnique({ where: { id } });
  return row ? parseRow(row) : null;
}

/**
 * Load the shop's default assistant. If none exists, lazily create one
 * with default config and mark it as the default. Callers always get a
 * valid record without having to do null-handling for first-time shops.
 */
export async function loadOrCreateDefaultAssistant(shop: string): Promise<AssistantRecord> {
  const existing = await prisma.assistant.findFirst({
    where: { shop, isDefault: true },
  });
  if (existing) return parseRow(existing);

  const created = await prisma.assistant.create({
    data: {
      shop,
      name: 'Default',
      isDefault: true,
      config: JSON.stringify(defaultConfig()),
    },
  });
  return parseRow(created);
}

export interface CreateInput {
  shop: string;
  name: string;
  config?: unknown;
}

export async function createAssistant(input: CreateInput): Promise<AssistantRecord> {
  const config = AssistantConfigSchema.parse(
    input.config ?? { business: {}, agent: {}, widget: {} },
  );
  // First assistant for a shop becomes the default automatically.
  const count = await prisma.assistant.count({ where: { shop: input.shop } });
  const isDefault = count === 0;
  const row = await prisma.assistant.create({
    data: {
      shop: input.shop,
      name: input.name.trim().slice(0, 80) || 'Untitled',
      isDefault,
      config: JSON.stringify(config),
    },
  });
  return parseRow(row);
}

export async function updateAssistant(
  id: string,
  patch: { name?: string; config?: unknown },
): Promise<AssistantRecord> {
  const data: { name?: string; config?: string } = {};
  if (patch.name !== undefined) {
    data.name = patch.name.trim().slice(0, 80) || 'Untitled';
  }
  if (patch.config !== undefined) {
    const validated = AssistantConfigSchema.parse(patch.config);
    data.config = JSON.stringify(validated);
  }
  const row = await prisma.assistant.update({ where: { id }, data });
  return parseRow(row);
}

/**
 * Promote the given assistant to default for its shop. Atomically clears
 * the default flag from any sibling and sets it on this one.
 */
export async function setDefaultAssistant(id: string): Promise<AssistantRecord> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.assistant.findUnique({ where: { id } });
    if (!target) throw new Error('Assistant not found');
    await tx.assistant.updateMany({
      where: { shop: target.shop, isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
    const updated = await tx.assistant.update({
      where: { id },
      data: { isDefault: true },
    });
    return parseRow(updated);
  });
}

/**
 * Delete an assistant. Promotes the oldest sibling to default if the
 * deleted one was the default. Returns the new default (or null if no
 * assistants remain — caller should handle that case).
 */
export async function deleteAssistant(id: string): Promise<AssistantRecord | null> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.assistant.findUnique({ where: { id } });
    if (!target) return null;
    await tx.assistant.delete({ where: { id } });
    if (!target.isDefault) {
      const currentDefault = await tx.assistant.findFirst({
        where: { shop: target.shop, isDefault: true },
      });
      return currentDefault ? parseRow(currentDefault) : null;
    }
    const replacement = await tx.assistant.findFirst({
      where: { shop: target.shop },
      orderBy: { createdAt: 'asc' },
    });
    if (!replacement) return null;
    const promoted = await tx.assistant.update({
      where: { id: replacement.id },
      data: { isDefault: true },
    });
    return parseRow(promoted);
  });
}
