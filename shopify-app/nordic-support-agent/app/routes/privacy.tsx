import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { useState } from 'react';
import { getAssistant } from '../lib/assistants.ts';

/**
 * Customer-facing self-service page. Hits /api/dsar/start with the email
 * and the chosen action. Localised in sv/en — chosen by ?lang= query or
 * Accept-Language. Shop is resolved server-side from ?a=<assistantId>
 * so it never appears in a URL the customer sees.
 */

interface LoaderData {
  shop: string | null;
  lang: 'sv' | 'en';
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const assistantId = url.searchParams.get('a');
  const langQ = url.searchParams.get('lang');
  let lang: 'sv' | 'en' = 'en';
  if (langQ === 'sv' || langQ === 'en') {
    lang = langQ;
  } else {
    const accept = request.headers.get('Accept-Language') ?? '';
    if (/^sv\b/i.test(accept)) lang = 'sv';
  }
  let shop: string | null = null;
  if (assistantId) {
    const a = await getAssistant(assistantId);
    if (a && a.published) shop = a.shop;
  }
  const data: LoaderData = { shop, lang };
  return data;
};

const T = {
  sv: {
    title: 'Sekretess & dina data',
    intro:
      'Du kan begära en kopia av dina chattdata eller radera dem helt. Vi skickar en bekräftelselänk till din e-postadress.',
    email: 'E-postadress',
    kindLabel: 'Vad vill du göra?',
    export: 'Exportera (skicka mig en kopia)',
    erase: 'Radera mina chattdata',
    submit: 'Skicka bekräftelselänk',
    ok: 'Om vi har data kopplad till denna e-post har vi skickat en länk. Kontrollera din inkorg.',
    error: 'Något gick fel. Försök igen senare.',
    missingShop:
      'Sidan öppnades utan butikskontext. Öppna länken från en butiks chattwidget.',
    retention: 'Vi sparar chattdata i 24 timmar. Verifieringskoder rensas efter 10 minuter.',
  },
  en: {
    title: 'Privacy & your data',
    intro:
      'You can request a copy of your chat data or have it erased. We will email you a confirmation link.',
    email: 'Email address',
    kindLabel: 'What would you like to do?',
    export: 'Export (send me a copy)',
    erase: 'Erase my chat data',
    submit: 'Send confirmation link',
    ok: 'If we hold data tied to this email, a link has been sent. Check your inbox.',
    error: 'Something went wrong. Please try again later.',
    missingShop:
      'This page was opened without a shop context. Open the link from a store chat widget.',
    retention: 'We retain chat data for 24 hours. Verification codes are purged after 10 minutes.',
  },
} as const;

export default function PrivacyPage() {
  const { shop, lang } = useLoaderData() as LoaderData;
  const t = T[lang];
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<'export' | 'erase'>('export');
  const [state, setState] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shop) return;
    setState('sending');
    try {
      const res = await fetch('/api/dsar/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, kind, shop }),
      });
      setState(res.ok ? 'ok' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        maxWidth: 480,
        margin: '64px auto',
        padding: '0 16px',
        color: '#111',
      }}
    >
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 24,
          background: '#fff',
        }}
      >
        <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>{t.title}</h1>
        <p style={{ margin: '0 0 20px', color: '#374151', lineHeight: 1.5 }}>{t.intro}</p>
        {!shop ? (
          <p style={{ color: '#b91c1c' }}>{t.missingShop}</p>
        ) : (
          <form onSubmit={submit}>
            <label
              style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}
            >
              {t.email}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 16,
                boxSizing: 'border-box',
              }}
            />
            <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
              <legend
                style={{ fontSize: 13, color: '#374151', marginBottom: 6, padding: 0 }}
              >
                {t.kindLabel}
              </legend>
              <label style={{ display: 'block', marginBottom: 4 }}>
                <input
                  type="radio"
                  name="kind"
                  value="export"
                  checked={kind === 'export'}
                  onChange={() => setKind('export')}
                />{' '}
                {t.export}
              </label>
              <label style={{ display: 'block' }}>
                <input
                  type="radio"
                  name="kind"
                  value="erase"
                  checked={kind === 'erase'}
                  onChange={() => setKind('erase')}
                />{' '}
                {t.erase}
              </label>
            </fieldset>
            <button
              type="submit"
              disabled={state === 'sending' || state === 'ok'}
              style={{
                background: '#111827',
                color: '#fff',
                border: 'none',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 14,
                cursor: state === 'sending' ? 'wait' : 'pointer',
                opacity: state === 'ok' ? 0.6 : 1,
              }}
            >
              {t.submit}
            </button>
            {state === 'ok' && (
              <p style={{ marginTop: 12, color: '#065f46' }}>{t.ok}</p>
            )}
            {state === 'error' && (
              <p style={{ marginTop: 12, color: '#b91c1c' }}>{t.error}</p>
            )}
          </form>
        )}
        <p style={{ marginTop: 24, fontSize: 12, color: '#6b7280' }}>{t.retention}</p>
      </div>
    </div>
  );
}
