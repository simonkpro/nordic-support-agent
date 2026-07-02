import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { SHELL_TOKENS } from './admin-shell';

/**
 * Onboarding wrapper. Full-page, no admin sidebar — first-run users see
 * a focused 5-step flow before they ever land on the dashboard.
 *
 * Layout mirrors the wireframe spec (Shell A): top header with brand +
 * "Save & exit" → horizontal stepper → content area → bottom footer
 * with Back / Skip / Continue. Styling reuses the Tandem palette and
 * Inter Tight typography from the rest of the dashboard so onboarding
 * and the live product feel like the same surface.
 */

const FONT_STACK =
  '"Inter Tight", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_STACK =
  '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const STEPS = [
  { key: 'welcome', label: 'Välkommen', href: '/onboarding/welcome', required: true },
  { key: 'knowledge', label: 'Kunskap', href: '/onboarding/knowledge', required: false },
  { key: 'persona', label: 'Persona', href: '/onboarding/persona', required: false },
  { key: 'brand', label: 'Varumärke', href: '/onboarding/brand', required: false },
  { key: 'install', label: 'Installera', href: '/onboarding/install', required: true },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];

export function OnboardingShell({
  step,
  title,
  subtitle,
  children,
  primaryLabel = 'Fortsätt',
  secondaryLabel,
  onPrimaryHref,
  onSecondaryHref,
  primaryAction,
  primaryActionState,
  primaryDisabled,
  showSkip = true,
}: {
  step: StepKey;
  title: string;
  subtitle?: string;
  children: ReactNode;
  primaryLabel?: string;
  secondaryLabel?: string;
  /** Where the primary CTA goes when it's just a link (no form). */
  onPrimaryHref?: string;
  /** Where the secondary CTA goes (e.g. "Mejla kodsnutten") */
  onSecondaryHref?: string;
  /** When set, primary CTA submits this form action with the page's form data. */
  primaryAction?: { method: 'POST'; intent: string; nextHref: string };
  /** External fetcher state for the primary action (for disabling). */
  primaryActionState?: 'idle' | 'submitting' | 'loading';
  primaryDisabled?: boolean;
  /** Hide the "Hoppa över" link on required steps. */
  showSkip?: boolean;
}) {
  const idx = STEPS.findIndex((s) => s.key === step);
  const prevStep = idx > 0 ? STEPS[idx - 1] : null;
  const nextStep = idx < STEPS.length - 1 ? STEPS[idx + 1] : null;
  const stepNumber = idx + 1;
  const totalSteps = STEPS.length;
  const isSubmitting = primaryActionState === 'submitting';

  return (
    <div
      style={{
        fontFamily: FONT_STACK,
        background: SHELL_TOKENS.bg,
        color: SHELL_TOKENS.ink,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* Top header */}
      <header
        style={{
          height: 64,
          borderBottom: `1px solid ${SHELL_TOKENS.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 40px',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
          Vitrio
        </div>
        <Link
          to="/preview/chat"
          style={{
            fontFamily: MONO_STACK,
            fontSize: 11,
            color: SHELL_TOKENS.muted,
            textDecoration: 'none',
            letterSpacing: '0.05em',
          }}
        >
          steg {stepNumber} / {totalSteps} · spara &amp; avsluta
        </Link>
      </header>

      {/* Stepper */}
      <div
        style={{
          padding: '24px 40px',
          display: 'flex',
          justifyContent: 'center',
          borderBottom: `1px dashed ${SHELL_TOKENS.lineDash}`,
        }}
      >
        <Stepper active={stepNumber} />
      </div>

      {/* Content */}
      <main
        style={{
          flex: 1,
          padding: '48px 56px 32px',
          maxWidth: 1100,
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontFamily: MONO_STACK,
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: SHELL_TOKENS.brand,
              marginBottom: 10,
            }}
          >
            Steg {stepNumber} · av {totalSteps}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                margin: '10px 0 0',
                color: SHELL_TOKENS.muted,
                fontSize: 14,
                maxWidth: 640,
                lineHeight: 1.55,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </main>

      {/* Footer */}
      <footer
        style={{
          height: 76,
          borderTop: `1px solid ${SHELL_TOKENS.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 40px',
          background: SHELL_TOKENS.bg,
        }}
      >
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          {prevStep ? (
            <Link
              to={prevStep.href}
              style={{
                fontFamily: 'inherit',
                fontSize: 13,
                color: SHELL_TOKENS.ink,
                textDecoration: 'none',
                padding: '8px 14px',
                borderRadius: 6,
              }}
            >
              ← Tillbaka
            </Link>
          ) : (
            <span />
          )}
          {showSkip ? (
            nextStep ? (
              <Link
                to={nextStep.href}
                style={{
                  fontSize: 13,
                  color: SHELL_TOKENS.muted,
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Hoppa över
              </Link>
            ) : null
          ) : (
            <span
              style={{
                fontFamily: MONO_STACK,
                fontSize: 11,
                color: SHELL_TOKENS.muted,
                letterSpacing: '0.05em',
              }}
            >
              · obligatoriskt steg
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {secondaryLabel && onSecondaryHref ? (
            <Link
              to={onSecondaryHref}
              style={{
                fontSize: 13,
                color: SHELL_TOKENS.ink,
                background: 'transparent',
                border: `1px solid ${SHELL_TOKENS.line}`,
                padding: '8px 16px',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              {secondaryLabel}
            </Link>
          ) : null}
          {primaryAction ? (
            <PrimarySubmitButton
              label={primaryLabel}
              isSubmitting={isSubmitting}
              disabled={primaryDisabled}
            />
          ) : onPrimaryHref ? (
            <Link
              to={onPrimaryHref}
              style={{
                background: SHELL_TOKENS.ink,
                color: '#fff',
                padding: '10px 20px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
                opacity: primaryDisabled ? 0.5 : 1,
                pointerEvents: primaryDisabled ? 'none' : 'auto',
              }}
            >
              {primaryLabel} →
            </Link>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

function PrimarySubmitButton({
  label,
  isSubmitting,
  disabled,
}: {
  label: string;
  isSubmitting?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      form="onboarding-form"
      disabled={isSubmitting || disabled}
      style={{
        background: SHELL_TOKENS.ink,
        color: '#fff',
        border: 0,
        padding: '10px 20px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        cursor: isSubmitting || disabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {isSubmitting ? 'Sparar…' : `${label} →`}
    </button>
  );
}

function Stepper({ active }: { active: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const n = i + 1;
        const done = n < active;
        const cur = n === active;
        return (
          <Wrap key={s.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 24,
                  border: `1px solid ${cur || done ? SHELL_TOKENS.ink : SHELL_TOKENS.line}`,
                  background: done ? SHELL_TOKENS.ink : 'transparent',
                  color: done ? '#fff' : cur ? SHELL_TOKENS.ink : SHELL_TOKENS.muted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: MONO_STACK,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                {done ? '✓' : n}
              </div>
              <div
                style={{
                  fontFamily: MONO_STACK,
                  fontSize: 11,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: cur ? SHELL_TOKENS.ink : SHELL_TOKENS.muted,
                  fontWeight: cur ? 600 : 400,
                }}
              >
                {s.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  width: 36,
                  height: 1,
                  background: SHELL_TOKENS.line,
                  margin: '0 16px',
                }}
              />
            )}
          </Wrap>
        );
      })}
    </div>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center' }}>{children}</div>;
}

// ============================================================
// Shared form primitives
// ============================================================

export function FieldLabel({
  label,
  hint,
  required,
}: {
  label: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div
      style={{
        fontFamily: MONO_STACK,
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: SHELL_TOKENS.muted,
        marginBottom: 6,
        display: 'flex',
        justifyContent: 'space-between',
      }}
    >
      <span>
        {label}
        {required && (
          <span style={{ color: SHELL_TOKENS.brand, marginLeft: 4 }}>*</span>
        )}
      </span>
      {hint && (
        <span
          style={{
            color: SHELL_TOKENS.muted,
            textTransform: 'none',
            letterSpacing: 0,
            fontFamily: 'inherit',
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

export function SegmentedPicker<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  /** When provided, also emits a hidden input so the value posts via form submit. */
  name?: string;
}) {
  return (
    <>
      <div
        style={{
          display: 'inline-flex',
          border: `1px solid ${SHELL_TOKENS.line}`,
          borderRadius: 8,
          background: SHELL_TOKENS.card,
          padding: 2,
        }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              style={{
                padding: '8px 14px',
                border: 0,
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'inherit',
                cursor: 'pointer',
                background: active ? SHELL_TOKENS.ink : 'transparent',
                color: active ? '#fff' : SHELL_TOKENS.muted,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}

export function RadioGrid<T extends string>({
  options,
  value,
  onChange,
  name,
  columns = 5,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  name?: string;
  columns?: number;
}) {
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 8,
        }}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              style={{
                height: 52,
                border: `1px solid ${on ? SHELL_TOKENS.ink : SHELL_TOKENS.line}`,
                borderRadius: 8,
                padding: '0 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: on ? SHELL_TOKENS.card : 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: SHELL_TOKENS.ink,
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 14,
                  border: `1px solid ${on ? SHELL_TOKENS.ink : SHELL_TOKENS.line}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {on && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 6,
                      background: SHELL_TOKENS.ink,
                    }}
                  />
                )}
              </span>
              <span style={{ fontSize: 13, textAlign: 'left' }}>{o.label}</span>
            </button>
          );
        })}
      </div>
      {name && <input type="hidden" name={name} value={value} />}
    </>
  );
}

export function TextInput({
  name,
  defaultValue,
  placeholder,
  required,
  type = 'text',
  mono,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'email' | 'url';
  mono?: boolean;
}) {
  return (
    <input
      type={type}
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      required={required}
      style={{
        width: '100%',
        height: 44,
        padding: '0 14px',
        border: `1px solid ${SHELL_TOKENS.line}`,
        borderRadius: 8,
        background: SHELL_TOKENS.card,
        color: SHELL_TOKENS.ink,
        fontSize: 14,
        fontFamily: mono ? MONO_STACK : 'inherit',
        boxSizing: 'border-box',
        outline: 'none',
      }}
    />
  );
}

export function MonoStack({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: MONO_STACK }}>{children}</span>;
}

export { FONT_STACK as ONBOARDING_FONT_STACK, MONO_STACK as ONBOARDING_MONO_STACK };
