# Design tokens & visual rules — Workspaces

The full token definitions live in `prototype/colors_and_type.css`. This doc summarizes them and
the visual rules so the Phase-A reconciliation (HANDOFF.md §3) is quick.

> **In Phase A, our codebase's real tokens win.** This is the prototype's system — reconcile it
> against ours, don't blindly copy. Token *names* below mirror the live LuckyStack theme so they
> should map cleanly.

## Color tokens (light → dark)
| Token | Role | Light | Dark |
|---|---|---|---|
| `background` | page bg | `#F5F5F5` | `#0B0F19` |
| `container1` (+`-hover`,`-border`) | cards/panels | `#FFFFFF` | `#111827` |
| `container2` (+`-hover`,`-border`) | inputs/sub-panels | `#F3F4F6` | `#1E293B` |
| `title` | headings | `#1E1F21` | `#F1F5F9` |
| `common` | body | `#4B5563` | `#AEB9C8` |
| `muted` | secondary/meta | `#8A93A1` | `#6B7688` |
| `disabled` | disabled text | `#C2C8D1` | `#475063` |
| `primary` (+`-hover`,`-border`) | accent / busy | `#3B82F6` | `#3B82F6` |
| `secondary` | 2nd accent (teal) | `#0EA5A4` | `#14B8A6` |
| `correct` | success / done | `#16A34A` | `#22C55E` |
| `warning` | needs-input | `#E0920A` | `#F0A93B` |
| `wrong` | error / destructive | `#E5484D` | `#F87171` |
| `overlay` | modal scrim | black/40% | black/62% |
| `focus-ring` | focus | primary tint | primary tint |
| `divider` | hairline | `#EEF0F3` | `#1A2333` |

**Terminal surface (fixed dark, both themes):** bg `#0C1018`, surface `#11161F`, text `#C9D4E3`,
ansi green/blue/amber/red/cyan. Terminals stay dark even in light mode.

**Status mapping:** needs-input → `warning`, busy → `primary` (soft pulse), done → `correct`,
idle/no-AI → `muted`. Pills use a ~10–12% tint of the semantic color with the solid color for
text/icon. **Never status-by-color-only — always a label/icon too.**

## Typography
- **Sans:** Inter (system-sans, Inter-like). **Mono:** JetBrains Mono (terminals, IDs `DEV-1240`,
  commit hashes, file paths, commands).
- Scale: page-title 24px (md+ up to 28) / section 16 semibold / body 14 / meta 12 / mono 13.
  Tight leading on titles (1.2), normal body (1.55), slight negative tracking on titles + mono.

## Shape, spacing, elevation
- **Radius:** cards/panels `rounded-2xl` (16px), inputs/buttons/pills `rounded-xl` (12px) or
  `rounded-full`. Soft, never sharp.
- **Spacing:** roomy — panels `p-5`/`p-6`, gaps `3`/`4`, sections `5`/`6`. Compact exceptions:
  board column, terminal, event-log (`gap-2`, `text-sm`/mono).
- **Borders:** thin hairlines (`container1-border`); dividers even lighter. Separate with
  whitespace over heavy rules.
- **Elevation:** light & diffuse. Cards near-flat with a gentle hover-lift; popovers/menus a soft
  shadow. No hard drop shadows, no glow.

## Motion
- Menus/popovers: fade + scale in from their edge (~170ms, ease-out-expo `cubic-bezier(0.16,1,0.3,1)`).
- Side panels/sheets: slide in from the right (desktop) / up (mobile), ~340ms iOS curve
  `cubic-bezier(0.32,0.72,0,1)`. Drawer slides from left.
- Modals / ⌘K: scale + lift + fade (~260ms expo).
- Toggles: knob glides; tab underline glides; caret rotates.
- Cards: subtle hover-lift. Busy status pill: soft opacity pulse.
- **Respect `prefers-reduced-motion`** — drop entrance transforms to instant.

## Backgrounds & "don'ts"
- Flat surfaces, **no gradients** (only semantic tint washes, e.g. `primary/10` drop-zone).
- No repeating patterns, no photographic backgrounds, no noise/grain, no frosted glass by default.
- Avoid AI-slop tropes: bluish-purple hero gradients, emoji cards, rounded-card-with-colored-
  left-border.

## Iconography
- **FontAwesome solid** (the set the codebase uses). In the prototype it's loaded via the SVG-JS
  CDN build with `data-mutate-approach="sync"` (so React-mounted `<i>` convert reliably).
  In our codebase use our normal FontAwesome React setup.
- No hand-drawn SVG iconography. Emoji only in the two deliberate spots: event-log actor glyphs
  (🤖/👤) and the "All caught up ✨" empty state.

## Responsive
- Breakpoint `md` = 768px. Desktop: nav rail + main + optional right panel + browser-style tab bar.
  Mobile: hamburger drawer + bottom tab-bar + FAB; popovers become bottom-sheets. ≥44px touch targets.
