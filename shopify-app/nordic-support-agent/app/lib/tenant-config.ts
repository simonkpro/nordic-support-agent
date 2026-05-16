import { z } from 'zod';
import prisma from '../db.server';

/**
 * Per-shop configuration. This is the single document that drives every
 * merchant-customizable thing in the product: agent persona, brand,
 * widget theming, language, (eventually) tool enablement + RAG sources.
 *
 * Add a new customization knob here, expose it in the admin form, and
 * read it where it matters. Avoid scattering customization across env
 * vars, hardcoded constants, or ad-hoc plumbing.
 */
export const TenantConfigSchema = z.object({
  agent: z.object({
    name: z.string().min(1).max(40).default('Support'),
    tone: z.enum(['friendly', 'professional', 'casual']).default('friendly'),
    greeting: z.string().max(280).default(''),
    signature: z.string().max(120).default(''),
    customRules: z.string().max(2000).default(''),
  }),
  brand: z.object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .default('#1f2937'),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .default('#1f2937'),
  }),
  language: z.enum(['sv', 'en', 'no', 'da', 'fi']).default('sv'),
  country: z.enum(['SE', 'NO', 'DK', 'FI']).default('SE'),
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

/**
 * Public-safe slice exposed to the storefront widget via /api/widget-config.
 * Excludes anything the merchant should be able to keep private from
 * customers (e.g. customRules — those describe agent behavior, not user UI).
 */
export type PublicWidgetConfig = {
  brand: TenantConfig['brand'];
  language: TenantConfig['language'];
  country: TenantConfig['country'];
  agent: { name: string };
};

export function toPublicConfig(config: TenantConfig): PublicWidgetConfig {
  return {
    brand: config.brand,
    language: config.language,
    country: config.country,
    agent: { name: config.agent.name },
  };
}

const DEFAULTS = TenantConfigSchema.parse({
  agent: {},
  brand: {},
});

export function defaultConfig(): TenantConfig {
  return DEFAULTS;
}

/**
 * Load a shop's config. Returns the parsed defaults if no row exists or if
 * the stored JSON is invalid (logged for follow-up; we don't want config
 * corruption to take the agent offline).
 */
export async function loadTenantConfig(shop: string): Promise<TenantConfig> {
  const row = await prisma.tenantConfig.findUnique({ where: { shop } });
  if (!row) return defaultConfig();
  try {
    const parsed = TenantConfigSchema.parse(JSON.parse(row.config));
    return parsed;
  } catch (err) {
    console.warn('[tenant-config] invalid stored config for', shop, err);
    return defaultConfig();
  }
}

/**
 * Save a shop's config. Validates with Zod before persisting; throws on
 * invalid input so callers can surface a form error.
 */
export async function saveTenantConfig(
  shop: string,
  patch: unknown,
): Promise<TenantConfig> {
  const validated = TenantConfigSchema.parse(patch);
  const serialized = JSON.stringify(validated);
  await prisma.tenantConfig.upsert({
    where: { shop },
    create: { shop, config: serialized },
    update: { config: serialized },
  });
  return validated;
}
