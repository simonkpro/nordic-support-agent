import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  CSSProperties,
} from 'react';
import { color, font, radius } from './theme';

export { theme, color, font, radius, shadow } from './theme';

/**
 * Shared UI primitives. Every surface (lander, sign-in, dashboard) composes
 * from these so styling lives in one place. All are plain styled elements —
 * no external UI dependency — and spread the native props through.
 */

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE: CSSProperties = {
  fontFamily: font.sans,
  fontWeight: 500,
  cursor: 'pointer',
  border: '1px solid transparent',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  transition: 'background 140ms ease, border-color 140ms ease',
};

const BUTTON_SIZE: Record<ButtonSize, CSSProperties> = {
  sm: { fontSize: 13, padding: '8px 14px' },
  md: { fontSize: 14, padding: '11px 18px' },
};

function buttonVariant(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return { background: color.brand, color: color.onBrand };
    case 'secondary':
      return { background: color.card, color: color.ink, borderColor: color.line };
    case 'danger':
      return { background: color.card, color: color.danger, borderColor: color.danger };
    case 'ghost':
      return { background: 'transparent', color: color.muted };
  }
}

export function Button({
  variant = 'primary',
  size = 'md',
  pill = false,
  fullWidth = false,
  style,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Fully-rounded pill (the marketing/CTA shape). */
  pill?: boolean;
  fullWidth?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        ...BUTTON_BASE,
        ...BUTTON_SIZE[size],
        ...buttonVariant(variant),
        borderRadius: pill ? radius.pill : radius.sm,
        width: fullWidth ? '100%' : undefined,
        opacity: rest.disabled ? 0.55 : 1,
        ...style,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// PillButton — the marketing CTA: a green pill with a circular arrow badge.
// Renders an anchor (used for external links: Calendly, mailto).
// ---------------------------------------------------------------------------

export function PillButton({
  href,
  children,
  variant = 'solid',
  large = false,
  newTab = false,
  style,
}: {
  href: string;
  children: ReactNode;
  variant?: 'solid' | 'inverse';
  large?: boolean;
  newTab?: boolean;
  style?: CSSProperties;
}) {
  const inverse = variant === 'inverse';
  const dim = large ? 30 : 26;
  return (
    <a
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        background: inverse ? color.card : color.brand,
        color: inverse ? color.brand : color.onBrand,
        borderRadius: radius.pill,
        padding: large ? '13px 10px 13px 26px' : '10px 8px 10px 20px',
        fontFamily: font.sans,
        fontSize: large ? 15 : 14,
        fontWeight: 500,
        textDecoration: 'none',
        ...style,
      }}
    >
      {children}
      <span
        aria-hidden="true"
        style={{
          width: dim,
          height: dim,
          borderRadius: '50%',
          background: inverse ? color.brand : color.card,
          color: inverse ? color.onBrand : color.brand,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2.6 7h8.8M7.7 3.3 11.4 7l-3.7 3.7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const CONTROL_BASE: CSSProperties = {
  width: '100%',
  fontFamily: font.sans,
  fontSize: 14,
  color: color.ink,
  background: color.card,
  border: `1px solid ${color.line}`,
  borderRadius: radius.sm,
  padding: '9px 11px',
  boxSizing: 'border-box',
  outline: 'none',
};

export function Input({ style, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx('ui-control', rest.className)} style={{ ...CONTROL_BASE, ...style }} />;
}

export function Textarea({ style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cx('ui-control', rest.className)}
      style={{ ...CONTROL_BASE, resize: 'vertical', lineHeight: 1.5, ...style }}
    />
  );
}

export function Select({ style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx('ui-control', rest.className)} style={{ ...CONTROL_BASE, ...style }} />;
}

// ---------------------------------------------------------------------------
// Card, Field, SectionLabel
// ---------------------------------------------------------------------------

export function Card({
  children,
  padding = 24,
  style,
}: {
  children: ReactNode;
  padding?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 500, color: color.muted, marginBottom: 14, ...style }}>
      {children}
    </div>
  );
}

/** Label + control + optional hint, stacked. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  style,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label htmlFor={htmlFor} style={{ fontSize: 13, color: color.muted }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 12, color: color.grey, lineHeight: 1.5 }}>{hint}</span>}
    </div>
  );
}

function cx(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
