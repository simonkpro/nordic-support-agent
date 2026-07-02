import { Form, Link } from 'react-router';
import type { ReactNode } from 'react';
import type { MembershipSummary } from '../lib/workspace-auth.ts';

/**
 * Shared admin shell — left rail with primary navigation, cream backdrop,
 * minimal type. Tandem-inspired palette: warm cream + forest sage + tan.
 *
 * Routes wrap their content with <AdminShell active="insights"> to get
 * the consistent chrome. Each route renders its own header inside.
 */

const PALETTE = {
  bg: '#f7f4ee',           // page background — warm cream
  card: '#fffdf8',         // panel surface — off-white
  ink: '#1f2823',          // primary text — near-black sage
  muted: '#6b6359',        // secondary text — warm grey
  line: '#ece6d8',         // hairline borders
  lineDash: '#dcd3bc',     // dashed dividers
  accent: '#c8a87a',       // warm tan
  brand: '#2c4a3e',        // deep forest sage
  green: '#5b8a72',        // resolved
  amber: '#c8924a',        // escalated
  grey: '#a39989',         // abandoned
};

export const SHELL_TOKENS = PALETTE;

const FONT_STACK =
  '"Inter Tight", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export type AdminSection = 'insights' | 'conversations' | 'settings' | 'account';

const NAV_ITEMS: Array<{ key: AdminSection; label: string; href: string }> = [
  { key: 'insights', label: 'Översikt', href: '/insights' },
  { key: 'conversations', label: 'Konversationer', href: '/insights/conversations' },
  { key: 'settings', label: 'Inställningar', href: '/preview/chat' },
  { key: 'account', label: 'Konto', href: '/settings' },
];

export function AdminShell({
  active,
  workspaceName,
  ownerEmail,
  memberships,
  impersonating,
  children,
}: {
  active: AdminSection;
  workspaceName?: string;
  ownerEmail?: string;
  /** When the signed-in user belongs to several workspaces, render the switcher. */
  memberships?: MembershipSummary[];
  /** Platform admin viewing as this workspace — show the exit banner. */
  impersonating?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="resp-shell"
      style={{
        fontFamily: FONT_STACK,
        background: PALETTE.bg,
        color: PALETTE.ink,
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        WebkitFontSmoothing: 'antialiased',
        paddingTop: impersonating ? 38 : 0,
      }}
    >
      {impersonating && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            background: '#7c2d12',
            color: '#fff',
            fontSize: 13,
            padding: '9px 16px',
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <span>
            Viewing as <strong>{workspaceName}</strong> (platform admin)
          </span>
          <Link to="/admin/impersonation/stop" style={{ color: '#fed7aa', fontWeight: 600 }}>
            Exit →
          </Link>
        </div>
      )}
      <aside
        style={{
          borderRight: `1px solid ${PALETTE.line}`,
          padding: '28px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Vitrio
          </div>
          {memberships && memberships.length > 1 ? (
            <Form method="post" action="/workspaces" style={{ marginTop: 6 }}>
              <select
                name="workspaceId"
                defaultValue=""
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                style={{
                  width: '100%',
                  fontSize: 12,
                  color: PALETTE.muted,
                  border: `1px solid ${PALETTE.line}`,
                  borderRadius: 6,
                  padding: '4px 6px',
                  background: PALETTE.card,
                }}
              >
                <option value="" disabled>
                  {workspaceName ?? 'Byt arbetsyta'}
                </option>
                {memberships.map((m) => (
                  <option key={m.workspaceId} value={m.workspaceId}>
                    {m.workspaceName}
                  </option>
                ))}
              </select>
            </Form>
          ) : (
            workspaceName && (
              <div style={{ fontSize: 12, color: PALETTE.muted, marginTop: 2 }}>
                {workspaceName}
              </div>
            )
          )}
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                to={item.href}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  fontSize: 13.5,
                  color: isActive ? PALETTE.ink : PALETTE.muted,
                  background: isActive ? PALETTE.line : 'transparent',
                  textDecoration: 'none',
                  fontWeight: isActive ? 500 : 400,
                  transition: 'background 120ms, color 120ms',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', fontSize: 11, color: PALETTE.muted, lineHeight: 1.5 }}>
          {ownerEmail && (
            <div style={{ marginBottom: 8 }}>{ownerEmail}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Link
              to="/onboarding/reset"
              style={{ color: PALETTE.muted, textDecoration: 'none' }}
              title="Nollställ och starta om guiden"
            >
              ↻ Kör onboarding igen
            </Link>
            <Link
              to="/auth/signout"
              style={{ color: PALETTE.muted, textDecoration: 'none' }}
            >
              Logga ut
            </Link>
          </div>
        </div>
      </aside>
      <main className="resp-main" style={{ padding: '40px 48px 80px', maxWidth: 1280 }}>{children}</main>
    </div>
  );
}

// ============================================================
// Shared primitives
// ============================================================

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 32,
        paddingBottom: 20,
        borderBottom: `1px dashed ${PALETTE.lineDash}`,
        gap: 24,
      }}
    >
      <div>
        <h1
          className="resp-h1"
          style={{
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 13.5,
              color: PALETTE.muted,
              lineHeight: 1.5,
              maxWidth: 560,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
    </header>
  );
}

export function Card({
  children,
  padding = 24,
  style,
}: {
  children: ReactNode;
  padding?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: PALETTE.card,
        border: `1px solid ${PALETTE.line}`,
        borderRadius: 12,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: PALETTE.muted,
        fontWeight: 600,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

export function OutcomeDot({ outcome }: { outcome: 'resolved' | 'escalated' | 'abandoned' }) {
  const color =
    outcome === 'resolved'
      ? PALETTE.green
      : outcome === 'escalated'
        ? PALETTE.amber
        : PALETTE.grey;
  return (
    <span
      title={outcome}
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}
