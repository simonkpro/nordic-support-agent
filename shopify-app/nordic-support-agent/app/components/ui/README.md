# UI — shared design system

One place for the product's visual language. The lander, sign-in, and the
whole dashboard compose from here.

## `theme.ts` — design tokens (edit colours/type/radii here)

```ts
import { color, font, radius } from '../components/ui/theme';
color.brand   // '#0e3d2a'  deep green
color.paper   // page background
color.ink / muted / grey / line / card
font.sans / font.mono
radius.sm / md / lg / xl / pill
```

Change a value here and it propagates everywhere. All the older token objects
are derived from this file:

- `SHELL_TOKENS` (components/admin-shell.tsx) → `color.*`
- the lander CSS variables (routes/_index/route.tsx) are interpolated from `color`/`font`
- routes/signin.tsx `T` → `color.*`

## `index.tsx` — primitives

```tsx
import { Button, PillButton, Input, Textarea, Select, Card, Field, SectionLabel } from '../components/ui';

<Button variant="primary|secondary|ghost|danger" size="sm|md" pill fullWidth />
<PillButton href="…" variant="solid|inverse" large newTab>Boka demo</PillButton>   // marketing CTA (renders <a>)
<Field label="Owner email" htmlFor="x"><Input id="x" name="ownerEmail" /></Field>
<Card padding={24}>…</Card>
<SectionLabel>New client workspace</SectionLabel>
```

Form controls (`Input`/`Textarea`/`Select`) carry a `.ui-control` class whose
focus ring lives in `app/styles/globals.css`.

## Extending

- New primitive → add it to `index.tsx`, style it from `color`/`font`/`radius`
  (never hard-code hex).
- Adopt incrementally: replace a route's local `const inputStyle = …` /
  `const buttonStyle = …` with `<Input>` / `<Button>` (see routes/admin._index.tsx).
- Responsive helpers (`resp-*` classes) live in `globals.css`.
