import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, redirect, useFetcher, useLoaderData } from 'react-router';
import { requireWorkspace } from '../lib/workspace-auth';
import { loadOrCreateDefaultAssistant, updateAssistant } from '../lib/assistants';
import {
  FieldLabel,
  OnboardingShell,
  SegmentedPicker,
} from '../components/onboarding-shell';
import { SHELL_TOKENS, SectionLabel } from '../components/admin-shell';
import { Input, Textarea } from '../components/ui';

interface LoaderData {
  name: string;
  tone: 'friendly' | 'professional' | 'casual';
  greeting: string;
  subtitle: string;
  primaryColor: string;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;
  const a = await loadOrCreateDefaultAssistant(shop);
  return {
    name: a.config.agent.name,
    tone: a.config.agent.tone,
    greeting: a.config.agent.greeting,
    subtitle: a.config.widget.subtitle,
    primaryColor: a.config.widget.primaryColor,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;
  const form = await request.formData();
  const a = await loadOrCreateDefaultAssistant(shop);
  await updateAssistant(a.id, {
    config: {
      ...a.config,
      agent: {
        ...a.config.agent,
        name: String(form.get('name') ?? '').trim() || 'Support',
        tone: form.get('tone') as LoaderData['tone'],
        greeting: String(form.get('greeting') ?? ''),
      },
      widget: {
        ...a.config.widget,
        subtitle: String(form.get('subtitle') ?? ''),
      },
    },
  });
  return redirect('/onboarding/brand');
};

const TONES: Array<{ value: LoaderData['tone']; label: string }> = [
  { value: 'friendly', label: 'Vänlig' },
  { value: 'professional', label: 'Professionell' },
  { value: 'casual', label: 'Avslappnad' },
];

export default function OnboardingPersona() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [tone, setTone] = useState(data.tone);
  const [name, setName] = useState(data.name);
  const [greeting, setGreeting] = useState(
    data.greeting || 'Hej! Hur kan jag hjälpa dig idag?',
  );
  const [subtitle, setSubtitle] = useState(
    data.subtitle || 'Svarar vanligtvis inom några minuter',
  );

  return (
    <OnboardingShell
      step="persona"
      title="Ge din agent en personlighet."
      subtitle="Allt har en vettig standard — ändra det som känns fel, strunta i resten."
      primaryAction={{ method: 'POST', intent: 'save', nextHref: '/onboarding/brand' }}
      primaryActionState={fetcher.state}
    >
      <Form method="post" id="onboarding-form">
        <div className="resp-two-col" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <FieldLabel label="Agentens namn" hint="visas i widgetens rubrik" />
              <Input
                type="text"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <FieldLabel label="Ton" />
              <SegmentedPicker
                options={TONES}
                value={tone}
                onChange={setTone}
                name="tone"
              />
            </div>
            <div>
              <FieldLabel label="Hälsning" hint="första meddelandet i widgeten" />
              <Textarea
                name="greeting"
                defaultValue={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <FieldLabel label="Underrubrik" hint="valfritt" />
              <Input
                type="text"
                name="subtitle"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Svarar vanligtvis inom några minuter"
              />
            </div>
          </div>
          <div>
            <SectionLabel>Förhandsvisning</SectionLabel>
            <PersonaPreview
              name={name}
              subtitle={subtitle}
              greeting={greeting}
              brand={data.primaryColor}
            />
            <p
              style={{
                fontFamily:
                  '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 10,
                color: SHELL_TOKENS.muted,
                marginTop: 10,
                textAlign: 'center',
              }}
            >
              Färger & former justeras i nästa steg.
            </p>
          </div>
        </div>
      </Form>
    </OnboardingShell>
  );
}

function PersonaPreview({
  name,
  subtitle,
  greeting,
  brand,
}: {
  name: string;
  subtitle: string;
  greeting: string;
  brand: string;
}) {
  const initial = (name || 'A').trim().charAt(0).toUpperCase() || 'A';
  return (
    <div
      style={{
        background: SHELL_TOKENS.card,
        border: `1px solid ${SHELL_TOKENS.line}`,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 18px 40px rgba(20,16,8,0.06)',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          background: brand,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.18)',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{name || 'Support'}</div>
          {subtitle && (
            <div style={{ fontSize: 12, opacity: 0.78 }}>{subtitle}</div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 16, opacity: 0.7 }}>×</div>
      </div>
      <div style={{ padding: '20px 16px', minHeight: 160 }}>
        <div
          style={{
            display: 'inline-block',
            background: SHELL_TOKENS.bg,
            color: SHELL_TOKENS.ink,
            padding: '10px 14px',
            borderRadius: 14,
            borderBottomLeftRadius: 6,
            fontSize: 13.5,
            lineHeight: 1.5,
            maxWidth: '82%',
          }}
        >
          {greeting || 'Hej! Hur kan jag hjälpa dig idag?'}
        </div>
      </div>
      <div
        style={{
          padding: 12,
          borderTop: `1px solid ${SHELL_TOKENS.line}`,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: SHELL_TOKENS.card,
        }}
      >
        <div
          style={{
            flex: 1,
            height: 32,
            border: `1px solid ${SHELL_TOKENS.line}`,
            borderRadius: 16,
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            fontSize: 12,
            color: SHELL_TOKENS.muted,
            background: SHELL_TOKENS.bg,
          }}
        >
          Skriv ett meddelande…
        </div>
        <div
          style={{
            width: 32,
            height: 32,
            background: brand,
            borderRadius: 999,
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontSize: 14,
          }}
        >
          ↑
        </div>
      </div>
    </div>
  );
}
