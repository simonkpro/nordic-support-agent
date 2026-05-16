import { useState } from 'react';
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from 'react-router';
import { useFetcher, useLoaderData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import {
  loadTenantConfig,
  saveTenantConfig,
  TenantConfigSchema,
  type TenantConfig,
} from '../lib/tenant-config.ts';

interface ActionResponse {
  ok: boolean;
  saved?: TenantConfig;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await loadTenantConfig(session.shop);
  return { config, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResponse> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const candidate: unknown = {
    agent: {
      name: formData.get('agent.name') ?? undefined,
      tone: formData.get('agent.tone') ?? undefined,
      greeting: formData.get('agent.greeting') ?? '',
      signature: formData.get('agent.signature') ?? '',
      customRules: formData.get('agent.customRules') ?? '',
    },
    brand: {
      color: formData.get('brand.color') ?? undefined,
      accentColor: formData.get('brand.accentColor') ?? undefined,
    },
    language: formData.get('language') ?? undefined,
    country: formData.get('country') ?? undefined,
  };

  try {
    const saved = await saveTenantConfig(session.shop, candidate);
    return { ok: true, saved };
  } catch (err) {
    const detail =
      err && typeof err === 'object' && 'issues' in err
        ? JSON.stringify((err as { issues: unknown }).issues)
        : (err as Error).message;
    return { ok: false, error: detail };
  }
};

export default function SettingsPage() {
  const { config: initialConfig, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // Local form state — submit posts the whole form, so we just track inputs.
  const [agentName, setAgentName] = useState(initialConfig.agent.name);
  const [agentTone, setAgentTone] = useState<TenantConfig['agent']['tone']>(
    initialConfig.agent.tone,
  );
  const [agentGreeting, setAgentGreeting] = useState(initialConfig.agent.greeting);
  const [agentSignature, setAgentSignature] = useState(initialConfig.agent.signature);
  const [agentRules, setAgentRules] = useState(initialConfig.agent.customRules);
  const [brandColor, setBrandColor] = useState(initialConfig.brand.color);
  const [accentColor, setAccentColor] = useState(initialConfig.brand.accentColor);
  const [language, setLanguage] = useState(initialConfig.language);
  const [country, setCountry] = useState(initialConfig.country);

  const isSubmitting =
    fetcher.state === 'submitting' || fetcher.state === 'loading';

  const submit = () => {
    const form = new FormData();
    form.set('agent.name', agentName);
    form.set('agent.tone', agentTone);
    form.set('agent.greeting', agentGreeting);
    form.set('agent.signature', agentSignature);
    form.set('agent.customRules', agentRules);
    form.set('brand.color', brandColor);
    form.set('brand.accentColor', accentColor);
    form.set('language', language);
    form.set('country', country);
    fetcher.submit(form, { method: 'POST' });
  };

  return (
    <s-page heading="Agent settings">
      <s-section heading="Agent persona">
        <s-paragraph>
          Customize how your support agent introduces itself, the tone it uses, and any
          merchant-specific rules it should follow. Changes apply on the next message —
          customers may need to refresh the storefront to see brand changes.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <FormRow label="Agent name">
            <input
              type="text"
              value={agentName}
              maxLength={40}
              onChange={(e) => setAgentName(e.target.value)}
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="Tone">
            <select
              value={agentTone}
              onChange={(e) => setAgentTone(e.target.value as TenantConfig['agent']['tone'])}
              style={inputStyle}
            >
              <option value="friendly">Friendly (default)</option>
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
            </select>
          </FormRow>

          <FormRow label="Greeting (optional, shown in widget on open)">
            <input
              type="text"
              value={agentGreeting}
              maxLength={280}
              onChange={(e) => setAgentGreeting(e.target.value)}
              placeholder="Hej! Hur kan jag hjälpa dig?"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="Signature (optional, appended to end of replies)">
            <input
              type="text"
              value={agentSignature}
              maxLength={120}
              onChange={(e) => setAgentSignature(e.target.value)}
              placeholder="— Astrid, Nordkust Support"
              style={inputStyle}
            />
          </FormRow>

          <FormRow label="Custom rules (free text — appended to agent's system prompt)">
            <textarea
              value={agentRules}
              maxLength={2000}
              onChange={(e) => setAgentRules(e.target.value)}
              placeholder="Examples:&#10;- Never discuss our pricing strategy.&#10;- If asked about black-friday returns, mention our 60-day return window.&#10;- Always offer a discount code DEMO10 for first-time buyers asking about shipping."
              rows={6}
              style={{ ...inputStyle, fontFamily: 'inherit' }}
            />
          </FormRow>
        </s-stack>
      </s-section>

      <s-section heading="Brand">
        <s-stack direction="block" gap="base">
          <FormRow label="Primary color (bubble, header, send button)">
            <input
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              style={{ ...inputStyle, width: 80, height: 36, padding: 2 }}
            />
            <input
              type="text"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              style={{ ...inputStyle, width: 120, marginLeft: 8 }}
            />
          </FormRow>

          <FormRow label="Accent color (focus rings, highlights)">
            <input
              type="color"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              style={{ ...inputStyle, width: 80, height: 36, padding: 2 }}
            />
            <input
              type="text"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              style={{ ...inputStyle, width: 120, marginLeft: 8 }}
            />
          </FormRow>
        </s-stack>
      </s-section>

      <s-section heading="Locale">
        <s-stack direction="block" gap="base">
          <FormRow label="Default language">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as TenantConfig['language'])}
              style={inputStyle}
            >
              <option value="sv">Svenska</option>
              <option value="en">English</option>
              <option value="no">Norsk</option>
              <option value="da">Dansk</option>
              <option value="fi">Suomi</option>
            </select>
          </FormRow>

          <FormRow label="Default country">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value as TenantConfig['country'])}
              style={inputStyle}
            >
              <option value="SE">Sweden</option>
              <option value="NO">Norway</option>
              <option value="DK">Denmark</option>
              <option value="FI">Finland</option>
            </select>
          </FormRow>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack direction="inline" gap="base">
          <s-button onClick={submit} {...(isSubmitting ? { loading: true } : {})}>
            Save
          </s-button>
          {fetcher.data?.ok && <s-text>Saved.</s-text>}
          {fetcher.data?.ok === false && <s-text>Error: {fetcher.data.error}</s-text>}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="What changes where">
        <s-paragraph>
          <strong>Agent name + tone + custom rules</strong> flow into the system prompt on
          every chat request. New customer messages see the change immediately.
        </s-paragraph>
        <s-paragraph>
          <strong>Brand color + accent</strong> are fetched by the storefront widget on page
          load. Refresh the storefront to pick up changes.
        </s-paragraph>
        <s-paragraph>
          <strong>Default language + country</strong> are used when a new conversation is
          created. Existing conversations keep their language.
        </s-paragraph>
        <s-paragraph>
          Shop: <s-text>{shop}</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 13, color: '#374151' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center' }}>{children}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  outline: 'none',
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
