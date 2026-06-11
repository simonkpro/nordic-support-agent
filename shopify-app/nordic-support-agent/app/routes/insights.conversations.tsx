import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData, useSearchParams } from 'react-router';
import { requireWorkspace, type MembershipSummary } from '../lib/workspace-auth';
import {
  AdminShell,
  Card,
  OutcomeDot,
  PageHeader,
  SHELL_TOKENS,
  SectionLabel,
} from '../components/admin-shell';
import {
  getConversationDetail,
  listRecentConversations,
  type ConversationDetail,
  type ConversationListItem,
} from '../lib/insights';

interface LoaderData {
  workspaceName: string;
  ownerEmail: string;
  memberships: MembershipSummary[];
  impersonating: boolean;
  filters: {
    outcomes: Array<'resolved' | 'escalated' | 'abandoned'>;
    hasEmail: boolean;
    hasHandoff: boolean;
    language: string | null;
    search: string;
  };
  list: ConversationListItem[];
  detail: ConversationDetail | null;
  selectedId: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const ctx = await requireWorkspace(request);
  const shop = ctx.workspace.id;

  const url = new URL(request.url);
  const outcomes = url.searchParams
    .getAll('outcome')
    .filter((s): s is 'resolved' | 'escalated' | 'abandoned' =>
      ['resolved', 'escalated', 'abandoned'].includes(s),
    );
  const hasEmail = url.searchParams.get('hasEmail') === '1';
  const hasHandoff = url.searchParams.get('hasHandoff') === '1';
  const language = url.searchParams.get('lang');
  const search = (url.searchParams.get('q') ?? '').trim();
  const selectedId = url.searchParams.get('id');

  const list = await listRecentConversations({
    shop,
    outcomes: outcomes.length ? outcomes : undefined,
    hasEmail: hasEmail || undefined,
    hasHandoff: hasHandoff || undefined,
    language: language ?? undefined,
    search: search || undefined,
    limit: 80,
  });

  const detail = selectedId ? await getConversationDetail(shop, selectedId) : null;

  return {
    workspaceName: ctx.workspace.name,
    ownerEmail: ctx.user.email,
    memberships: ctx.memberships,
    impersonating: ctx.impersonating,
    filters: { outcomes, hasEmail, hasHandoff, language, search },
    list,
    detail,
    selectedId,
  };
};

export default function ConversationsView() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  function toggleOutcome(o: 'resolved' | 'escalated' | 'abandoned') {
    const next = new URLSearchParams(searchParams);
    const current = next.getAll('outcome');
    next.delete('outcome');
    if (current.includes(o)) {
      current.filter((c) => c !== o).forEach((c) => next.append('outcome', c));
    } else {
      current.forEach((c) => next.append('outcome', c));
      next.append('outcome', o);
    }
    setSearchParams(next);
  }

  function setFlag(key: string, value: boolean) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, '1');
    else next.delete(key);
    setSearchParams(next);
  }

  function setSearch(q: string) {
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q);
    else next.delete('q');
    setSearchParams(next);
  }

  return (
    <AdminShell
      active="conversations"
      workspaceName={data.workspaceName}
      ownerEmail={data.ownerEmail}
      memberships={data.memberships}
      impersonating={data.impersonating}
    >
      <PageHeader
        title="Konversationer"
        subtitle="Alla konversationer från de senaste 24 timmarna, med vad boten gjorde och vad den hänvisade till."
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr 280px',
          gap: 16,
          alignItems: 'start',
          minHeight: 600,
        }}
      >
        {/* LEFT — filters + list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card padding={16}>
            <input
              type="search"
              placeholder="Sök i meddelanden…"
              defaultValue={data.filters.search}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch((e.target as HTMLInputElement).value);
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: `1px solid ${SHELL_TOKENS.line}`,
                borderRadius: 8,
                fontSize: 13,
                fontFamily: 'inherit',
                background: '#fff',
                color: SHELL_TOKENS.ink,
                marginBottom: 12,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(['resolved', 'escalated', 'abandoned'] as const).map((o) => {
                const active = data.filters.outcomes.includes(o);
                const label =
                  o === 'resolved' ? 'Hanterade' : o === 'escalated' ? 'Skickade' : 'Avbrutna';
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => toggleOutcome(o)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      border: `1px solid ${active ? SHELL_TOKENS.ink : SHELL_TOKENS.line}`,
                      borderRadius: 6,
                      background: active ? SHELL_TOKENS.ink : 'transparent',
                      color: active ? '#fff' : SHELL_TOKENS.muted,
                      fontFamily: 'inherit',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <FilterToggle
              label="Verifierad e-post"
              active={data.filters.hasEmail}
              onClick={() => setFlag('hasEmail', !data.filters.hasEmail)}
            />
            <FilterToggle
              label="Skickade till människa"
              active={data.filters.hasHandoff}
              onClick={() => setFlag('hasHandoff', !data.filters.hasHandoff)}
            />
          </Card>

          <Card padding={0} style={{ overflow: 'hidden' }}>
            <div
              style={{
                maxHeight: 600,
                overflowY: 'auto',
              }}
            >
              {data.list.length === 0 ? (
                <p style={{ padding: 18, margin: 0, fontSize: 13, color: SHELL_TOKENS.muted }}>
                  Inga konversationer matchar filtren.
                </p>
              ) : (
                data.list.map((c, i) => (
                  <ConversationRow
                    key={c.id}
                    item={c}
                    active={c.id === data.selectedId}
                    isFirst={i === 0}
                  />
                ))
              )}
            </div>
          </Card>
        </div>

        {/* MIDDLE — thread */}
        <div>
          {data.detail ? (
            <ConversationThread detail={data.detail} />
          ) : (
            <Card padding={48} style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, color: SHELL_TOKENS.muted, fontSize: 13 }}>
                Välj en konversation för att se utskriften.
              </p>
            </Card>
          )}
        </div>

        {/* RIGHT — context */}
        <div>
          {data.detail ? (
            <ContextPanel detail={data.detail} />
          ) : (
            <Card padding={24} style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, color: SHELL_TOKENS.muted, fontSize: 12 }}>
                Detaljer om konversationen visas här när du valt en.
              </p>
            </Card>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '8px 0',
        background: 'transparent',
        border: 0,
        borderTop: `1px dashed ${SHELL_TOKENS.lineDash}`,
        fontFamily: 'inherit',
        fontSize: 12.5,
        color: SHELL_TOKENS.ink,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          width: 28,
          height: 16,
          borderRadius: 999,
          background: active ? SHELL_TOKENS.brand : SHELL_TOKENS.line,
          position: 'relative',
          transition: 'background 120ms',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: active ? 14 : 2,
            width: 12,
            height: 12,
            borderRadius: 999,
            background: '#fff',
            transition: 'left 120ms',
          }}
        />
      </span>
    </button>
  );
}

function ConversationRow({
  item,
  active,
  isFirst,
}: {
  item: ConversationListItem;
  active: boolean;
  isFirst: boolean;
}) {
  return (
    <Link
      to={`/insights/conversations?id=${item.id}`}
      style={{
        display: 'block',
        padding: '14px 16px',
        borderTop: isFirst ? 'none' : `1px dashed ${SHELL_TOKENS.lineDash}`,
        background: active ? SHELL_TOKENS.line : 'transparent',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <OutcomeDot outcome={item.outcome} />
        <span style={{ fontSize: 11, color: SHELL_TOKENS.muted }}>{timeAgo(item.startedAt)}</span>
        {item.verifiedEmail && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: SHELL_TOKENS.brand,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            verifierad
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 13,
          color: SHELL_TOKENS.ink,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: 4,
        }}
      >
        {item.preview || <em style={{ color: SHELL_TOKENS.muted }}>(inget meddelande)</em>}
      </div>
      <div style={{ fontSize: 11, color: SHELL_TOKENS.muted }}>
        {item.language.toUpperCase()} · {item.turns} meddelande{item.turns === 1 ? '' : 'n'}
        {item.originHost ? ` · ${item.originHost}` : ''}
      </div>
    </Link>
  );
}

function ConversationThread({ detail }: { detail: ConversationDetail }) {
  return (
    <Card padding={0} style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '18px 24px',
          borderBottom: `1px dashed ${SHELL_TOKENS.lineDash}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <OutcomeDot outcome={detail.outcome} />
        <span style={{ fontSize: 12, color: SHELL_TOKENS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {detail.outcome === 'resolved'
            ? 'Hanterad'
            : detail.outcome === 'escalated'
              ? 'Skickad till dig'
              : 'Avbruten'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: SHELL_TOKENS.muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {detail.id.slice(0, 8)}
        </span>
      </div>
      {/* Messages */}
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {detail.messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '82%',
                padding: '10px 14px',
                borderRadius: 14,
                background: m.role === 'user' ? SHELL_TOKENS.ink : SHELL_TOKENS.line,
                color: m.role === 'user' ? '#fff' : SHELL_TOKENS.ink,
                fontSize: 13.5,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                borderBottomLeftRadius: m.role === 'user' ? 14 : 4,
              }}
            >
              {m.content}
            </div>
            <span style={{ fontSize: 10, color: SHELL_TOKENS.muted, marginTop: 4 }}>
              {m.role === 'user' ? 'Kund' : 'Bot'}
              {m.at ? ` · ${new Date(m.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>
        ))}
        {detail.messages.length === 0 && (
          <p style={{ margin: 0, fontSize: 12, color: SHELL_TOKENS.muted }}>
            Inga meddelanden loggade.
          </p>
        )}
      </div>
    </Card>
  );
}

function ContextPanel({ detail }: { detail: ConversationDetail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card padding={18}>
        <SectionLabel>Identitet</SectionLabel>
        <KV label="E-post" value={detail.verifiedEmail ?? <em style={{ color: SHELL_TOKENS.muted }}>Inte verifierad</em>} />
        <KV label="Sida" value={detail.originHost ?? '—'} />
        <KV label="Språk" value={`${detail.language} · ${detail.country}`} />
        <KV label="Startade" value={new Date(detail.createdAt).toLocaleString('sv-SE')} />
      </Card>

      {/* What the bot actually did — human-friendly summary rather than
       * raw tool calls. We count knowledge-base hits + handoff in plain
       * language. Engineers can still see the raw payloads via the
       * collapsed Diagnostics section below. */}
      {(() => {
        const kbCalls = detail.toolCalls.filter((tc) => tc.name === 'search_knowledge_base').length;
        const handoffCalls = detail.toolCalls.filter((tc) => tc.name === 'create_handoff_ticket').length;
        const verifyCalls = detail.toolCalls.filter((tc) => tc.name === 'verify_code' || tc.name === 'request_verification_code').length;
        if (kbCalls + handoffCalls + verifyCalls === 0) return null;
        return (
          <Card padding={18}>
            <SectionLabel>Vad boten gjorde</SectionLabel>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12.5, color: SHELL_TOKENS.ink, lineHeight: 1.7 }}>
              {kbCalls > 0 && (
                <li>· Sökte i kunskapsbasen {kbCalls === 1 ? 'en gång' : `${kbCalls} gånger`}</li>
              )}
              {handoffCalls > 0 && <li>· Skickade ett ärende till din supportinkorg</li>}
              {verifyCalls > 0 && <li>· Verifierade kundens identitet via e-post</li>}
            </ul>
          </Card>
        );
      })()}

      {detail.citedSources.length > 0 && (
        <Card padding={18}>
          <SectionLabel>Hänvisad kunskap</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.citedSources.map((s) => (
              <div key={s.label} style={{ fontSize: 12 }}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: SHELL_TOKENS.brand, textDecoration: 'none' }}>
                    {s.label}
                  </a>
                ) : (
                  <span style={{ color: SHELL_TOKENS.ink }}>{s.label}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {detail.handoffTriggered && (
        <Card padding={18}>
          <SectionLabel>Överlämning</SectionLabel>
          <p style={{ margin: 0, fontSize: 12, color: SHELL_TOKENS.muted }}>
            Ett supportärende skapades under denna konversation. Kolla din
            supportinkorg för full kontext.
          </p>
        </Card>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: `1px dashed ${SHELL_TOKENS.lineDash}` }}>
      <span style={{ color: SHELL_TOKENS.muted }}>{label}</span>
      <span style={{ color: SHELL_TOKENS.ink, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  );
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
