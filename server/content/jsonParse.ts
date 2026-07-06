//? Robust JSON extraction from an LLM response (M3). Models wrap JSON in ```json fences or prose, so a
//? bare `JSON.parse` fails. `extractJson` strips fences, finds the first balanced `{…}` (string-aware),
//? and parses it — returning null (never throwing) when there is no valid object. Pure + shared by the
//? script + reference-video live parsers so both read a real structured response the same way.

//? Find the first balanced `{…}` region in `text`, respecting string literals + escapes. Returns the
//? substring or null.
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (inStr) {
      if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    switch (c) {
    case '"': { inStr = true; break; }
    case '{': { depth += 1; break; }
    case '}': {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
      break;
    }
    default: { break; }
    }
  }
  return null;
}

//? Parse the first JSON object out of an LLM response (fenced or inline). Never throws → null on miss.
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1]?.trim() ?? text;
  const block = candidate.trim().startsWith('{') ? candidate.trim() : firstBalancedObject(candidate);
  if (block === null) return null;
  // eslint-disable-next-line luckystack/no-raw-try-catch -- JSON.parse on model output is expected to fail sometimes; a failed parse is control flow (→ null), not a captured error.
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

//? Coerce an unknown into a beat list `{text, visualPrompt}[]` — tolerant of missing fields. Shared by
//? both live parsers so a model's `beats` array maps to real storyboard beats.
export function coerceBeats(raw: unknown): { text: string; visualPrompt: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b): { text: string; visualPrompt: string } | null => {
      if (b === null || typeof b !== 'object') return null;
      const o = b as { text?: unknown; visualPrompt?: unknown; visual?: unknown };
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (text.length === 0) return null;
      const visual = typeof o.visualPrompt === 'string' ? o.visualPrompt : (typeof o.visual === 'string' ? o.visual : '');
      return { text, visualPrompt: visual.trim() || `a shot illustrating: ${text}` };
    })
    .filter((b): b is { text: string; visualPrompt: string } => b !== null);
}
