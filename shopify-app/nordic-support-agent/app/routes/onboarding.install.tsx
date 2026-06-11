import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, redirect, useFetcher, useLoaderData } from 'react-router';
import { requireWorkspace, markOnboardingComplete } from '../lib/workspace-auth';
import { loadOrCreateDefaultAssistant } from '../lib/assistants';
import { signWidgetToken } from '../lib/widget-token';
import { OnboardingShell } from '../components/onboarding-shell';
import { Card, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';

interface LoaderData {
  assistantId: string;
  widgetToken: string;
  origin: string;
}

function buildOrigin(request: Request): string {
  const fwdProto = request.headers.get('X-Forwarded-Proto');
  const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
  if (fwdProto && fwdHost) return `${fwdProto}://${fwdHost}`;
  return new URL(request.url).origin;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;
  const a = await loadOrCreateDefaultAssistant(shop);
  return {
    assistantId: a.id,
    widgetToken: signWidgetToken(shop, { assistantId: a.id, epoch: a.tokenEpoch }),
    origin: buildOrigin(request),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { workspace } = await requireWorkspace(request);
  await markOnboardingComplete(workspace.id);
  return redirect('/preview/chat');
};

type Platform = 'shopify' | 'wordpress' | 'html';

export default function OnboardingInstall() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [platform, setPlatform] = useState<Platform>('shopify');
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${data.origin}/widget.js" data-assistant="${data.assistantId}" async defer></script>`;

  function copy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <OnboardingShell
      step="install"
      title="Installera widgeten."
      subtitle="Klistra in raden nedan på din sajt — boten är live så fort sidan laddats om. Förhandsvisningen till höger kör mot din riktiga konfiguration."
      showSkip={false}
      primaryLabel="Till dashboard"
      primaryAction={{ method: 'POST', intent: 'complete', nextHref: '/preview/chat' }}
      primaryActionState={fetcher.state}
    >
      <Form method="post" id="onboarding-form" style={{ display: 'none' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        {/* LEFT — snippet + paste-here */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <div
              style={{
                fontFamily:
                  '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: SHELL_TOKENS.muted,
                marginBottom: 10,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Kodsnutt</span>
              <button
                type="button"
                onClick={copy}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: copied ? SHELL_TOKENS.green : SHELL_TOKENS.brand,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {copied ? 'Kopierad ✓' : 'Kopiera →'}
              </button>
            </div>
            <div
              style={{
                background: '#0f1217',
                color: '#e6e2d6',
                padding: '18px 18px',
                borderRadius: 10,
                fontFamily:
                  '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12.5,
                lineHeight: 1.7,
                position: 'relative',
                wordBreak: 'break-all',
              }}
            >
              <div style={{ color: '#7a8a9c', marginBottom: 6 }}>
                &lt;!-- klistra in före &lt;/body&gt; --&gt;
              </div>
              <div>
                <span style={{ color: '#9bb4d4' }}>&lt;script </span>
                <span style={{ color: '#c8a87a' }}>src</span>=
                <span>"{data.origin}/widget.js"</span>{' '}
                <span style={{ color: '#c8a87a' }}>data-assistant</span>=
                <span>"{data.assistantId}"</span>{' '}
                <span>async defer</span>
                <span style={{ color: '#9bb4d4' }}>&gt;&lt;/script&gt;</span>
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Var du klistrar in</SectionLabel>
            <div
              style={{
                display: 'flex',
                gap: 0,
                borderBottom: `1px solid ${SHELL_TOKENS.line}`,
                marginBottom: 16,
              }}
            >
              {[
                { v: 'shopify' as const, l: 'Shopify' },
                { v: 'wordpress' as const, l: 'WordPress' },
                { v: 'html' as const, l: 'Vanlig HTML' },
              ].map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setPlatform(t.v)}
                  style={{
                    padding: '10px 16px',
                    border: 0,
                    background: 'transparent',
                    borderBottom: `2px solid ${platform === t.v ? SHELL_TOKENS.ink : 'transparent'}`,
                    marginBottom: -1,
                    fontSize: 13,
                    color: platform === t.v ? SHELL_TOKENS.ink : SHELL_TOKENS.muted,
                    fontWeight: platform === t.v ? 600 : 400,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {t.l}
                </button>
              ))}
            </div>
            {platform === 'shopify' && (
              <PasteSteps
                steps={[
                  'Logga in i Shopify Admin.',
                  <>
                    Gå till <strong>Online Store → Themes → Edit code</strong>.
                  </>,
                  <>
                    Öppna <Mono>layout/theme.liquid</Mono>.
                  </>,
                  <>
                    Klistra in kodsnutten precis före <Mono>&lt;/body&gt;</Mono>.
                  </>,
                  'Spara. Widgeten dyker upp inom ~30 sekunder.',
                ]}
              />
            )}
            {platform === 'wordpress' && (
              <PasteSteps
                steps={[
                  'Logga in i WordPress Admin.',
                  <>
                    Gå till <strong>Appearance → Theme File Editor</strong>.
                  </>,
                  <>
                    Öppna <Mono>footer.php</Mono>.
                  </>,
                  <>
                    Klistra in kodsnutten precis före <Mono>&lt;/body&gt;</Mono>.
                  </>,
                  <>
                    Eller använd plugins som <strong>Insert Headers and Footers</strong> för
                    att klistra in i footer-zonen utan att redigera tema.
                  </>,
                ]}
              />
            )}
            {platform === 'html' && (
              <PasteSteps
                steps={[
                  <>
                    Klistra in kodsnutten precis före den stängande{' '}
                    <Mono>&lt;/body&gt;</Mono>-taggen.
                  </>,
                  'På varje sida där widgeten ska visas (eller i en gemensam template / layout).',
                  'Ingen build-process behövs — vanlig HTML räcker.',
                ]}
              />
            )}
          </div>

          <Card style={{ background: SHELL_TOKENS.bg, borderStyle: 'dashed' }}>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: SHELL_TOKENS.muted,
                lineHeight: 1.6,
              }}
            >
              Widgeten fungerar bara på domäner du tillåtit. Standard: alla
              domäner. Begränsa under <strong>Inställningar → Säkerhet</strong>{' '}
              i dashboarden när du är live.
            </p>
          </Card>
        </div>

        {/* RIGHT — live iframe */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
              fontFamily:
                '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: SHELL_TOKENS.muted,
            }}
          >
            <span>Live-widget — testa den</span>
            <span style={{ color: SHELL_TOKENS.brand }}>● ansluten</span>
          </div>
          <div
            style={{
              border: `1px solid ${SHELL_TOKENS.line}`,
              borderRadius: 10,
              background: SHELL_TOKENS.bg,
              height: 540,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <iframe
              src={`/widget-test.html?token=${encodeURIComponent(data.widgetToken)}&open=1`}
              title="Widget preview"
              style={{
                width: '100%',
                height: '100%',
                border: 0,
                background: 'transparent',
              }}
            />
          </div>
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
            Skriv en fråga för att testa boten mot din indexerade kunskap.
          </p>
        </div>
      </div>
    </OnboardingShell>
  );
}

function PasteSteps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol
      style={{
        margin: 0,
        padding: '0 0 0 22px',
        fontSize: 13.5,
        color: SHELL_TOKENS.ink,
        lineHeight: 1.7,
      }}
    >
      {steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily:
          '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12.5,
        background: SHELL_TOKENS.card,
        padding: '1px 6px',
        borderRadius: 4,
        border: `1px solid ${SHELL_TOKENS.line}`,
      }}
    >
      {children}
    </code>
  );
}
