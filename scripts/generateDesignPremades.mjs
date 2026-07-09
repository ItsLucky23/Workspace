// Compile the Designer's built-in premade LOOKS (apple, material, …) into a compact JSON the server's
// design-system context-doc includes, so the CODING agent can build a UI in a named look ("apple style
// dropdown") using the real tokens — without the user first copying it into their workspace.
//
// The designer data modules (premades/themes/styles/fonts) only import TYPES, so this node script can load
// them directly. Run: node scripts/generateDesignPremades.mjs  (also wired into the AI-context refresh.)

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const premadesUrl = pathToFileURL(path.join(root, 'src', 'workspaces', 'designer', 'premades.ts')).href;
const { PREMADE_LOOKS, resolveLook } = await import(premadesUrl);

// The distinguishing tokens/props the agent needs to build recognizably in a look (kept compact, not all 30).
const KEY_TOKENS = ['background', 'container1', 'primary', 'primary-hover', 'secondary', 'title', 'common', 'muted'];

const looks = [];
for (const l of PREMADE_LOOKS) {
  const r = resolveLook(l.id);
  if (!r) continue;
  const pick = (tokens) => Object.fromEntries(KEY_TOKENS.filter((k) => typeof tokens?.[k] === 'string').map((k) => [k, tokens[k]]));
  looks.push({
    id: l.id,
    name: l.name,
    description: l.description,
    theme: { light: pick(r.theme.light), dark: pick(r.theme.dark) },
    style: {
      radius: r.style.radius, radiusLg: r.style.radiusLg, pill: r.style.pill,
      border: r.style.border, density: r.style.density, motion: r.style.motion,
      shadow: r.style.shadow, weightHeading: r.style.weightHeading,
    },
    fontHeading: r.fontHeading,
    fontBody: r.fontBody,
  });
}

const out = { generatedFrom: 'src/workspaces/designer/premades.ts', count: looks.length, looks };
const dest = path.join(root, 'docs', 'AI_DESIGN_PREMADES.json');
writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`[design-premades] wrote ${String(looks.length)} looks → docs/AI_DESIGN_PREMADES.json`);
