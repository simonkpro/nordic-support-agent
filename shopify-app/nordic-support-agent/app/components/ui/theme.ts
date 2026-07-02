/**
 * The single source of truth for the product's visual language — used by the
 * marketing lander, the sign-in page, and the whole dashboard. Change a
 * brand colour, radius, or font here and it propagates everywhere.
 *
 * Consumers:
 *  - components/ui/* primitives (Button, Input, Card, …)
 *  - components/admin-shell.tsx (SHELL_TOKENS is derived from this)
 *  - routes/_index/route.tsx (lander CSS variables are built from this)
 *  - routes/signin.tsx
 */

export const color = {
  /** Page background — warm off-white "paper". */
  paper: '#f7f6f3',
  /** Recessed panel / canvas (e.g. the lander product block). */
  panel: '#ededea',
  /** Raised surface — cards, inputs. */
  card: '#ffffff',
  /** Primary text — near-black. */
  ink: '#12140f',
  /** Secondary text. */
  muted: '#71716b',
  /** Tertiary text / disabled. */
  grey: '#9a9a94',
  /** Hairline borders and dividers. */
  line: '#e2e1db',
  /** Brand — deep racing green. */
  brand: '#0e3d2a',
  /** Brand, pressed/hover. */
  brandDeep: '#0a2f21',
  /** Text on a brand-coloured surface. */
  onBrand: '#ffffff',
  /** Status. */
  success: '#2f7d5a',
  warning: '#b7791f',
  danger: '#a3452e',
} as const;

export const font = {
  sans: '"Schibsted Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const shadow = {
  card: '0 1px 2px rgba(18,20,15,0.04)',
  raised: '0 18px 44px -28px rgba(18,20,15,0.30)',
} as const;

export const theme = { color, font, radius, shadow } as const;
export type Theme = typeof theme;
