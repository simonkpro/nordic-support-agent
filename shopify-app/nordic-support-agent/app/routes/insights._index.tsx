import type { LoaderFunctionArgs } from 'react-router';
import { redirect, useLoaderData, useSearchParams, Link } from 'react-router';
import { getWorkspaceFromRequest, isOnboardingComplete } from '../lib/workspace-auth';
import { loadOrCreateDefaultAssistant } from '../lib/assistants';
import {
  AdminShell,
  Card,
  PageHeader,
  SHELL_TOKENS,
  SectionLabel,
} from '../components/admin-shell';
import {
  getActivityHeatmap,
  getOverview,
  getRecentEscalations,
  getResponseTimeStats,
  type ActivityHeatmap,
  type OverviewKpis,
  type RecentEscalation,
  type ResponseTimeStats,
} from '../lib/insights';

/**
 * Insights overview — designed for non-technical merchants. We surface
 * the questions a business owner actually asks:
 *   - how many people the bot helped this week
 *   - what % of them got resolved vs. needed a human
 *   - how fast is the bot
 *   - when are customers messaging (weekday × hour)
 *   - what languages do they speak / what pages do they come from
 *   - which conversations needed an escalation
 *
 * Two cards are placeholders until the matching capabilities ship:
 *   - "Top issues" needs the categorization pass on purge (coming).
 *   - "Customer satisfaction" needs the post-chat thumbs UI (coming).
 *
 * Tool calls / token costs are intentionally NOT on this page — they
 * matter for engineers, not store owners. They live in the conversation
 * detail view if you really want them.
 */

const PRESET_RANGES: Array<{ key: string; label: string; days: number }> = [
  { key: 'today', label: 'Idag', days: 0 },
  { key: '7d', label: '7 dagar', days: 7 },
  { key: '30d', label: '30 dagar', days: 30 },
];

interface LoaderData {
  workspaceName: string;
  ownerEmail: string;
  range: { key: string };
  kpis: OverviewKpis;
  heatmap: ActivityHeatmap;
  responseTime: ResponseTimeStats;
  recentEscalations: RecentEscalation[];
  businessType:
    | 'ecommerce'
    | 'beauty_clinic'
    | 'dental'
    | 'healthcare'
    | 'real_estate'
    | 'consulting'
    | 'education'
    | 'restaurant'
    | 'physical_retail'
    | 'service'
    | 'other';
  onboardingDone: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const session = await getWorkspaceFromRequest(request);
  if (!session && process.env.NODE_ENV === 'production') throw redirect('/signin');
  const shop = session?.workspaceId ?? 'preview-shop.myshopify.com';

  const url = new URL(request.url);
  const rangeKey = url.searchParams.get('range') ?? '7d';
  const preset = PRESET_RANGES.find((p) => p.key === rangeKey) ?? PRESET_RANGES[1]!;
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - preset.days * 24 * 60 * 60 * 1000);

  const [kpis, heatmap, responseTime, recentEscalations, defaultAssistant, onboardingDone] =
    await Promise.all([
      getOverview({ shop, from, to }),
      getActivityHeatmap(shop, from, to),
      getResponseTimeStats(shop, from, to),
      getRecentEscalations(shop, 5),
      loadOrCreateDefaultAssistant(shop),
      session ? isOnboardingComplete(session.workspaceId) : Promise.resolve(true),
    ]);

  return {
    workspaceName: session?.workspaceName ?? 'Preview shop',
    ownerEmail: session?.ownerEmail ?? '',
    range: { key: preset.key },
    kpis,
    heatmap,
    responseTime,
    recentEscalations,
    businessType: defaultAssistant.config.business.type,
    onboardingDone,
  };
};

export default function InsightsIndex() {
  const data = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const activeRange = data.range.key;

  const { kpis, heatmap, responseTime } = data;
  const total = kpis.conversationCount;
  const pct = (n: number) => (total === 0 ? '—' : Math.round((n / total) * 100) + '%');
  const avgTurns = total === 0 ? '—' : (kpis.totalTurns / total).toFixed(1);
  const replyTime = responseTime.p50Ms == null ? '—' : formatMs(responseTime.p50Ms);

  return (
    <AdminShell
      active="insights"
      workspaceName={data.workspaceName}
      ownerEmail={data.ownerEmail}
    >
      {!data.onboardingDone && <ContinueSetupBanner />}
      <PageHeader
        title="Översikt"
        subtitle="Vad kunderna frågar om, hur boten hanterar dem, och när de är online."
        right={
          <RangeSwitch
            active={activeRange}
            onChange={(k) => setSearchParams({ range: k })}
          />
        }
      />

      {/* KPI strip — business-owner-friendly only */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 12,
          marginBottom: 28,
        }}
      >
        <Kpi label="Konversationer" value={String(total)} hint="Kunder som fått hjälp" />
        <Kpi label="Hanterade av bot" value={pct(kpis.resolvedCount)} hint={`${kpis.resolvedCount} lösta utan människa`} />
        <Kpi label="Skickade till dig" value={pct(kpis.escalatedCount)} hint={`${kpis.escalatedCount} överlämnade`} />
        <Kpi label="Meddelanden / chatt" value={avgTurns} hint="Snitt per konversation" />
        <Kpi label="Svarstid" value={replyTime} hint={responseTime.sampleSize > 0 ? `p50 av ${responseTime.sampleSize} svar` : 'Ingen data ännu'} />
      </div>

      {/* Outcomes per day + heatmap */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '3fr 2fr',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <OutcomesByDayChart byDay={kpis.byDay} />
        <ActivityHeatmapCard heatmap={heatmap} />
      </div>

      {/* Issues (live) + satisfaction (still placeholder) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <TopList
          title="Vanligaste ärenden"
          items={kpis.categoryCounts.map((c) => ({
            label: categoryLabel(c.category, data.businessType),
            count: c.count,
          }))}
          empty="Inga kategoriserade konversationer ännu — kategorin sätts när chatten avslutas (inom 24 timmar)."
        />
        <ComingSoonCard
          title="Kundnöjdhet"
          body="Kunder kommer få ge tummen upp eller ner efter varje chatt. Snittbetyget och fördelning per ärendetyp visas här."
        />
      </div>

      {/* Languages + origin hosts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <TopList
          title="Språk"
          items={kpis.languageCounts.map((l) => ({ label: languageName(l.language), count: l.count }))}
          empty="Inga konversationer ännu."
        />
        <TopList
          title="Var kunderna chattar ifrån"
          items={kpis.originHostCounts.map((o) => ({ label: o.host, count: o.count }))}
          empty="Inga sidor har visat widgeten ännu."
        />
      </div>

      {/* Recent escalations */}
      <Card>
        <SectionLabel>Konversationer som behövde dig</SectionLabel>
        {data.recentEscalations.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: SHELL_TOKENS.muted }}>
            Inga nyligen. När boten lämnar över till en människa visas dessa här.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {data.recentEscalations.map((e, i) => (
              <Link
                key={e.id}
                to={`/insights/conversations?id=${e.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr 140px',
                  gap: 16,
                  padding: '14px 0',
                  borderTop: i === 0 ? 'none' : `1px dashed ${SHELL_TOKENS.lineDash}`,
                  textDecoration: 'none',
                  color: 'inherit',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: 12, color: SHELL_TOKENS.muted }}>
                  {timeAgo(e.startedAt)}
                </span>
                <span style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.firstUserMessage || <em style={{ color: SHELL_TOKENS.muted }}>(inget meddelande)</em>}
                </span>
                <span style={{ fontSize: 12, color: SHELL_TOKENS.muted, textAlign: 'right' }}>
                  {e.originHost ?? '—'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <p style={{ marginTop: 32, fontSize: 11, color: SHELL_TOKENS.muted, textAlign: 'center' }}>
        Aggregerad data sparas tills vidare · Konversationsinnehåll sparas i 24 timmar · Ingen personlig data i aggregat
      </p>
    </AdminShell>
  );
}

function ContinueSetupBanner() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '16px 20px',
        background: SHELL_TOKENS.card,
        border: `1px solid ${SHELL_TOKENS.ink}`,
        borderRadius: 10,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: SHELL_TOKENS.brand,
          color: '#fff',
          display: 'grid',
          placeItems: 'center',
          fontFamily:
            '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        ⤴
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
          Fortsätt inställningen — widgeten är inte installerad än
        </div>
        <div style={{ fontSize: 12.5, color: SHELL_TOKENS.muted }}>
          Några steg kvar innan boten är live på din sajt. Det tar ~3 minuter.
        </div>
      </div>
      <Link
        to="/onboarding/welcome"
        style={{
          background: SHELL_TOKENS.ink,
          color: '#fff',
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Fortsätt →
      </Link>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card padding={18}>
      <div style={{ fontSize: 11, color: SHELL_TOKENS.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: SHELL_TOKENS.muted, marginTop: 6 }}>{hint}</div>}
    </Card>
  );
}

function RangeSwitch({ active, onChange }: { active: string; onChange: (key: string) => void }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        border: `1px solid ${SHELL_TOKENS.line}`,
        borderRadius: 8,
        background: SHELL_TOKENS.card,
        padding: 2,
      }}
    >
      {PRESET_RANGES.map((p) => {
        const isActive = p.key === active;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            style={{
              padding: '6px 12px',
              border: 0,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
              background: isActive ? SHELL_TOKENS.ink : 'transparent',
              color: isActive ? '#fff' : SHELL_TOKENS.muted,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function OutcomesByDayChart({ byDay }: { byDay: OverviewKpis['byDay'] }) {
  const max = Math.max(1, ...byDay.map((d) => d.resolved + d.escalated + d.abandoned));
  return (
    <Card>
      <SectionLabel>Utfall per dag</SectionLabel>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${byDay.length}, minmax(0, 1fr))`,
          gap: 6,
          height: 180,
          alignItems: 'end',
        }}
      >
        {byDay.map((d) => {
          const total = d.resolved + d.escalated + d.abandoned;
          const h = (n: number) => `${(n / max) * 100}%`;
          return (
            <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
              <div
                title={`${d.day}: ${d.resolved} hanterade, ${d.escalated} skickade till dig, ${d.abandoned} avbrutna`}
                style={{
                  width: '60%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column-reverse',
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: SHELL_TOKENS.line,
                  opacity: total === 0 ? 0.4 : 1,
                }}
              >
                <div style={{ height: h(d.resolved), background: SHELL_TOKENS.green }} />
                <div style={{ height: h(d.escalated), background: SHELL_TOKENS.amber }} />
                <div style={{ height: h(d.abandoned), background: SHELL_TOKENS.grey }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: SHELL_TOKENS.muted }}>{d.day.slice(5)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 11, color: SHELL_TOKENS.muted }}>
        <Legend color={SHELL_TOKENS.green} label="Hanterade av bot" />
        <Legend color={SHELL_TOKENS.amber} label="Skickade till dig" />
        <Legend color={SHELL_TOKENS.grey} label="Avbrutna" />
      </div>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}

const WEEKDAY_LABELS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

function ActivityHeatmapCard({ heatmap }: { heatmap: ActivityHeatmap }) {
  const max = Math.max(1, ...heatmap.cells.flat());
  const peakLabel = heatmap.peak
    ? `Mest aktivt: ${WEEKDAY_LABELS[heatmap.peak.weekday]} ${String(heatmap.peak.hour).padStart(2, '0')}:00`
    : null;
  return (
    <Card>
      <SectionLabel>När kunderna chattar</SectionLabel>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '28px repeat(24, minmax(0, 1fr))',
          gap: 2,
          alignItems: 'center',
        }}
      >
        {/* spacer */}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={h}
            style={{
              fontSize: 8,
              color: SHELL_TOKENS.muted,
              textAlign: 'center',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {h % 6 === 0 ? h : ''}
          </div>
        ))}
        {heatmap.cells.map((row, w) => (
          <>
            <div
              key={`label-${w}`}
              style={{ fontSize: 10, color: SHELL_TOKENS.muted, textAlign: 'right', paddingRight: 4 }}
            >
              {WEEKDAY_LABELS[w]}
            </div>
            {row.map((count, h) => {
              const intensity = count / max;
              return (
                <div
                  key={`${w}-${h}`}
                  title={`${WEEKDAY_LABELS[w]} ${String(h).padStart(2, '0')}:00 — ${count} konversation${count === 1 ? '' : 'er'}`}
                  style={{
                    aspectRatio: '1 / 1',
                    background:
                      count === 0
                        ? SHELL_TOKENS.line
                        : mix(SHELL_TOKENS.line, SHELL_TOKENS.brand, intensity),
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 11, color: SHELL_TOKENS.muted }}>
        <span>{peakLabel ?? 'Inga konversationer ännu'}</span>
        <span>{heatmap.total} totalt</span>
      </div>
    </Card>
  );
}

/** Mix two hex colors by t∈[0,1]. Cheap LERP, good enough for a heatmap. */
function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
function parseHex(h: string): { r: number; g: number; b: number } {
  const s = h.replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function ComingSoonCard({ title, body }: { title: string; body: string }) {
  return (
    <Card padding={24} style={{ background: SHELL_TOKENS.bg, borderStyle: 'dashed' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <SectionLabel>{title}</SectionLabel>
        <span
          style={{
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: SHELL_TOKENS.brand,
            border: `1px solid ${SHELL_TOKENS.brand}`,
            padding: '2px 6px',
            borderRadius: 4,
            marginBottom: 14,
            marginLeft: 'auto',
          }}
        >
          Snart
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: SHELL_TOKENS.muted, lineHeight: 1.55 }}>
        {body}
      </p>
    </Card>
  );
}

function TopList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
  empty: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <Card>
      <SectionLabel>{title}</SectionLabel>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: SHELL_TOKENS.muted }}>{empty}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((i) => (
            <div key={i.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                <span style={{ color: SHELL_TOKENS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                  {i.label}
                </span>
                <span style={{ color: SHELL_TOKENS.muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5 }}>
                  {i.count}
                </span>
              </div>
              <div style={{ height: 4, background: SHELL_TOKENS.line, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(i.count / max) * 100}%`, height: '100%', background: SHELL_TOKENS.brand }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function languageName(code: string): string {
  return ({ sv: 'Svenska', en: 'Engelska', no: 'Norska', da: 'Danska', fi: 'Finska' } as Record<string, string>)[code] ?? code;
}

/**
 * Friendly category labels per business vertical. The underlying enum
 * is stable; this just shapes the dashboard copy so a clinic sees
 * "Bookings" while a webshop sees "Shipping".
 */
function categoryLabel(key: string, type: LoaderData['businessType']): string {
  const baseline: Record<string, string> = {
    booking: 'Bokningar',
    shipping: 'Leveranser',
    returns: 'Returer & återbetalningar',
    product: 'Produkter',
    service_info: 'Tjänsteinfo',
    pricing: 'Priser',
    account: 'Konto',
    complaint: 'Klagomål',
    general: 'Allmän info',
    other: 'Övrigt',
  };
  const overrides = VERTICAL_OVERRIDES[type] ?? {};
  return overrides[key] ?? baseline[key] ?? key;
}

const VERTICAL_OVERRIDES: Record<LoaderData['businessType'], Record<string, string>> = {
  ecommerce: {},
  beauty_clinic: {
    booking: 'Tidsbokningar',
    returns: 'Avbokningar',
    product: 'Behandlingar',
    service_info: 'Behandlingsinfo',
    account: 'Kundkonton',
  },
  dental: {
    booking: 'Tidsbokningar',
    returns: 'Avbokningar',
    product: 'Behandlingar',
    service_info: 'Behandlingsinfo',
    account: 'Patientkonton',
  },
  healthcare: {
    booking: 'Tidsbokningar',
    returns: 'Avbokningar',
    product: 'Tjänster',
    service_info: 'Tjänsteinfo',
    account: 'Patientkonton',
  },
  real_estate: {
    booking: 'Visningar',
    returns: 'Uppsägningar',
    product: 'Lägenheter',
    service_info: 'Fastighetsinfo',
    account: 'Hyresgästportal',
  },
  consulting: {
    booking: 'Möten',
    returns: 'Omplaneringar',
    product: 'Tjänster',
    service_info: 'Upplägg & metod',
    account: 'Klientportal',
  },
  education: {
    booking: 'Anmälan',
    returns: 'Avhopp',
    product: 'Kurser',
    service_info: 'Utbildningsinfo',
    account: 'Studentkonton',
  },
  restaurant: {
    booking: 'Bordsbokningar',
    returns: 'Avbokningar',
    product: 'Meny',
    service_info: 'Catering / evenemang',
  },
  physical_retail: {
    shipping: 'Hämta i butik',
    service_info: 'Tjänster i butik',
  },
  service: {
    booking: 'Tidsbokningar',
    returns: 'Avbokningar',
    product: 'Behandlingar',
    service_info: 'Tjänsteinfo',
    account: 'Kundkonton',
  },
  other: {},
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just nu';
  if (min < 60) return `${min} min sedan`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} tim sedan`;
  const d = Math.floor(hr / 24);
  return `${d} dgr sedan`;
}
