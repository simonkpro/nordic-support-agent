import type { LanguageModel } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { env } from '../env.ts';

/**
 * Resolve a model identifier to a concrete LanguageModel from whichever
 * provider the env selects. Lets us swap between Vercel AI Gateway,
 * direct Anthropic, and direct Google without touching agent code.
 *
 * AI_PROVIDER:
 *   - 'gateway'   (default) → @ai-sdk/gateway, needs AI_GATEWAY_API_KEY
 *   - 'anthropic'           → @ai-sdk/anthropic, needs ANTHROPIC_API_KEY
 *   - 'google'              → @ai-sdk/google, needs GOOGLE_GENERATIVE_AI_API_KEY
 *
 * Model strings can keep the gateway "provider/model" form (e.g.
 * "anthropic/claude-sonnet-4-6"); the matching prefix is stripped before
 * the provider sees it. Lets the same env values work across providers.
 */
export function getModel(modelString: string): LanguageModel {
  const provider = env.aiProvider;
  if (provider === 'anthropic') {
    return anthropic(stripPrefix(modelString, 'anthropic'));
  }
  if (provider === 'google') {
    return google(stripPrefix(modelString, 'google'));
  }
  return gateway(modelString);
}

function stripPrefix(name: string, prefix: string): string {
  return name.startsWith(`${prefix}/`) ? name.slice(prefix.length + 1) : name;
}

/**
 * Throw early if the selected provider's required env var is missing.
 * Called at the top of runAgent / streamAgent so failures surface as
 * actionable errors before any LLM call.
 */
export function assertProviderConfigured(): void {
  const provider = env.aiProvider;
  if (provider === 'gateway' && !env.aiGatewayApiKey) {
    throw new Error(
      'AI_PROVIDER=gateway but AI_GATEWAY_API_KEY is not set. Add a key from https://vercel.com/dashboard/ai-gateway.',
    );
  }
  if (provider === 'anthropic' && !env.anthropicApiKey) {
    throw new Error(
      'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Add a key from https://console.anthropic.com.',
    );
  }
  if (provider === 'google' && !env.googleApiKey) {
    throw new Error(
      'AI_PROVIDER=google but GOOGLE_GENERATIVE_AI_API_KEY is not set. Add a key from https://aistudio.google.com.',
    );
  }
}
