import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, redirect, useFetcher, useLoaderData } from 'react-router';
import { requireWorkspace } from '../lib/workspace-auth';
import { loadOrCreateDefaultAssistant, updateAssistant } from '../lib/assistants';
import { FieldLabel, OnboardingShell, SegmentedPicker } from '../components/onboarding-shell';
import { Card, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';

interface LoaderData {
  primaryColor: string;
  accentColor: string;
  theme: 'light' | 'dark';
  agentName: string;
  subtitle: string;
  greeting: string;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;
  const a = await loadOrCreateDefaultAssistant(shop);
  return {
    primaryColor: a.config.widget.primaryColor,
    accentColor: a.config.widget.accentColor,
    theme: a.config.widget.theme,
    agentName: a.config.agent.name,
    subtitle: a.config.widget.subtitle || 'Svarar vanligtvis inom några minuter',
    greeting: a.config.agent.greeting || 'Hej! Hur kan jag hjälpa dig idag?',
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
      widget: {
        ...a.config.widget,
        primaryColor: String(form.get('primaryColor') ?? a.config.widget.primaryColor),
        accentColor: String(form.get('accentColor') ?? a.config.widget.accentColor),
        theme: form.get('theme') as 'light' | 'dark',
      },
    },
  });
  return redirect('/onboarding/install');
};

const PRESETS = [
  { name: 'Cream', brand: '#1a1a1a', accent: '#e85d4a', theme: 'light' as const },
  { name: 'Tandem', brand: '#2c4a3e', accent: '#c8a87a', theme: 'light' as const },
  { name: 'Cobalt', brand: '#1e40af', accent: '#fbbf24', theme: 'light' as const },
  { name: 'Forest', brand: '#14532d', accent: '#84cc16', theme: 'light' as const },
  { name: 'Ember', brand: '#9a3412', accent: '#fde68a', theme: 'light' as const },
  { name: 'Violet', brand: '#6d28d9', accent: '#22d3ee', theme: 'light' as const },
  { name: 'Slate', brand: '#0f172a', accent: '#38bdf8', theme: 'dark' as const },
  { name: 'Plum', brand: '#3b0764', accent: '#f0abfc', theme: 'dark' as const },
  { name: 'Carbon', brand: '#0a0a0a', accent: '#22c55e', theme: 'dark' as const },
];

export default function OnboardingBrand() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [brand, setBrand] = useState(data.primaryColor);
  const [accent, setAccent] = useState(data.accentColor);
  const [theme, setTheme] = useState<'light' | 'dark'>(data.theme);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  function applyPreset(p: (typeof PRESETS)[number]) {
    setBrand(p.brand);
    setAccent(p.accent);
    setTheme(p.theme);
  }

  const activePreset = PRESETS.find(
    (p) => p.brand.toLowerCase() === brand.toLowerCase(),
  );

  return (
    <OnboardingShell
      step="brand"
      title="Matcha ditt varumärke."
      subtitle="Välj en förinställning eller sätt en egen färg. Resten av widgetens utseende (typsnitt, former, ytor) finns kvar i dashboarden."
      primaryAction={{ method: 'POST', intent: 'save', nextHref: '/onboarding/install' }}
      primaryActionState={fetcher.state}
    >
      <Form method="post" id="onboarding-form">
        <input type="hidden" name="primaryColor" value={brand} />
        <input type="hidden" name="accentColor" value={accent} />
        <input type="hidden" name="theme" value={theme} />
        <div className="resp-two-col" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            <div>
              <FieldLabel label="Förinställning" hint="9 utvalda paletter" />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 10,
                }}
              >
                {PRESETS.map((p) => {
                  const on = activePreset?.name === p.name;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(p)}
                      style={{
                        border: `1px solid ${on ? SHELL_TOKENS.ink : SHELL_TOKENS.line}`,
                        borderRadius: 10,
                        padding: '12px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: on ? SHELL_TOKENS.card : 'transparent',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          background: p.brand,
                          position: 'relative',
                          flexShrink: 0,
                          boxShadow: '0 0 0 1px ' + SHELL_TOKENS.line,
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            right: -2,
                            bottom: -2,
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: p.accent,
                            border: `2px solid ${SHELL_TOKENS.card}`,
                          }}
                        />
                      </span>
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: on ? 600 : 500,
                            color: SHELL_TOKENS.ink,
                          }}
                        >
                          {p.name}
                        </div>
                        <div
                          style={{
                            fontFamily:
                              '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontSize: 10,
                            color: SHELL_TOKENS.muted,
                          }}
                        >
                          {p.brand}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <FieldLabel label="Egen varumärkesfärg" hint="åsidosätter förinställning" />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="color"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  style={{
                    width: 44,
                    height: 44,
                    border: `1px solid ${SHELL_TOKENS.line}`,
                    borderRadius: 8,
                    padding: 0,
                    background: 'none',
                    cursor: 'pointer',
                  }}
                />
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  style={{
                    flex: 1,
                    height: 44,
                    padding: '0 14px',
                    border: `1px solid ${SHELL_TOKENS.line}`,
                    borderRadius: 8,
                    background: SHELL_TOKENS.card,
                    color: SHELL_TOKENS.ink,
                    fontSize: 13,
                    fontFamily:
                      '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
            <Card style={{ background: SHELL_TOKENS.bg, borderStyle: 'dashed' }}>
              <SectionLabel>Mer i dashboarden</SectionLabel>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: SHELL_TOKENS.muted,
                  lineHeight: 1.6,
                }}
              >
                Typsnitt, storlekar, former, ytor och mörkt läge anpassas helt
                under <strong>Inställningar → Skräddarsy chattruta</strong>.
                Det räcker med en färg för att gå live.
              </p>
            </Card>
          </div>
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <SectionLabel>Förhandsvisning</SectionLabel>
              <SegmentedPicker
                value={device}
                onChange={setDevice}
                options={[
                  { value: 'desktop', label: 'Dator' },
                  { value: 'mobile', label: 'Mobil' },
                ]}
              />
            </div>
            {device === 'desktop' ? (
              <DesktopPreview brand={brand} name={data.agentName || 'Support'} subtitle={data.subtitle} greeting={data.greeting} />
            ) : (
              <MobilePreview brand={brand} name={data.agentName || 'Support'} greeting={data.greeting} />
            )}
          </div>
        </div>
      </Form>
    </OnboardingShell>
  );
}

function DesktopPreview({
  brand,
  name,
  subtitle,
  greeting,
}: {
  brand: string;
  name: string;
  subtitle: string;
  greeting: string;
}) {
  return (
    <div
      style={{
        height: 380,
        border: `1px solid ${SHELL_TOKENS.line}`,
        borderRadius: 10,
        background: SHELL_TOKENS.bg,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Fake page chrome */}
      <div
        style={{
          height: 28,
          borderBottom: `1px solid ${SHELL_TOKENS.line}`,
          background: SHELL_TOKENS.card,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 10,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: SHELL_TOKENS.line,
            }}
          />
        ))}
      </div>
      <div style={{ padding: 22 }}>
        <div style={{ height: 8, width: '45%', background: SHELL_TOKENS.line, marginBottom: 10, borderRadius: 2 }} />
        <div style={{ height: 6, width: '85%', background: SHELL_TOKENS.line, marginBottom: 4, borderRadius: 2 }} />
        <div style={{ height: 6, width: '60%', background: SHELL_TOKENS.line, marginBottom: 16, borderRadius: 2 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ height: 72, background: SHELL_TOKENS.line, borderRadius: 4 }} />
          <div style={{ height: 72, background: SHELL_TOKENS.line, borderRadius: 4 }} />
        </div>
      </div>
      {/* Widget bubble */}
      <div style={{ position: 'absolute', bottom: 16, right: 16 }}>
        <MiniWidget brand={brand} name={name} subtitle={subtitle} greeting={greeting} />
      </div>
    </div>
  );
}

function MobilePreview({
  brand,
  name,
  greeting,
}: {
  brand: string;
  name: string;
  greeting: string;
}) {
  const initial = (name || 'A').trim().charAt(0).toUpperCase() || 'A';
  return (
    <div
      style={{
        height: 380,
        border: `1px solid ${SHELL_TOKENS.line}`,
        borderRadius: 10,
        background: SHELL_TOKENS.bg,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 200,
          height: 340,
          background: SHELL_TOKENS.card,
          borderRadius: 24,
          border: `1px solid ${SHELL_TOKENS.line}`,
          overflow: 'hidden',
          position: 'relative',
          boxShadow: '0 12px 32px rgba(20,16,8,0.10)',
        }}
      >
        <div
          style={{
            width: 60,
            height: 14,
            background: SHELL_TOKENS.ink,
            borderRadius: 14,
            position: 'absolute',
            top: 6,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        />
        <div style={{ position: 'absolute', top: 32, left: 10, right: 10, bottom: 30 }}>
          <div
            style={{
              background: SHELL_TOKENS.card,
              border: `1px solid ${SHELL_TOKENS.line}`,
              borderRadius: 12,
              height: '100%',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: 10,
                background: brand,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.18)',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {initial}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{name || 'Support'}</div>
              <span style={{ marginLeft: 'auto', fontSize: 12 }}>×</span>
            </div>
            <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '85%',
                  background: SHELL_TOKENS.bg,
                  padding: '6px 10px',
                  borderRadius: 12,
                  borderBottomLeftRadius: 4,
                  fontSize: 10,
                  lineHeight: 1.45,
                  color: SHELL_TOKENS.ink,
                }}
              >
                {greeting}
              </div>
            </div>
            <div
              style={{
                padding: 8,
                borderTop: `1px solid ${SHELL_TOKENS.line}`,
                display: 'flex',
                gap: 6,
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 22,
                  border: `1px solid ${SHELL_TOKENS.line}`,
                  borderRadius: 6,
                }}
              />
              <div
                style={{
                  width: 22,
                  height: 22,
                  background: brand,
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        </div>
        <div
          style={{
            width: 60,
            height: 3,
            background: SHELL_TOKENS.line,
            borderRadius: 3,
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        />
      </div>
    </div>
  );
}

function MiniWidget({
  brand,
  name,
  subtitle,
  greeting,
}: {
  brand: string;
  name: string;
  subtitle: string;
  greeting: string;
}) {
  const initial = (name || 'A').trim().charAt(0).toUpperCase() || 'A';
  return (
    <div
      style={{
        width: 260,
        background: SHELL_TOKENS.card,
        border: `1px solid ${SHELL_TOKENS.line}`,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(20,16,8,0.12)',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          background: brand,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.18)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{name || 'Support'}</div>
          {subtitle && <div style={{ fontSize: 10, opacity: 0.78 }}>{subtitle}</div>}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.75 }}>×</div>
      </div>
      <div style={{ padding: 12 }}>
        <div
          style={{
            display: 'inline-block',
            background: SHELL_TOKENS.bg,
            padding: '8px 10px',
            borderRadius: 10,
            borderBottomLeftRadius: 4,
            fontSize: 11.5,
            lineHeight: 1.4,
            maxWidth: '84%',
          }}
        >
          {greeting}
        </div>
      </div>
    </div>
  );
}
