# Bug report — `@luckystack/core` `validateType` infinite-recurses on a nested union

**Package:** `@luckystack/core` **0.3.0** (whole `@luckystack/*` suite is `^0.3.0` in this repo).
**File (built):** `node_modules/@luckystack/core/dist/index.js` → `var validateType` (≈ line 1733) +
`var splitTopLevel` (≈ line 1559). Source is presumably `src/.../validation` in the framework repo.
**Symptom in this app:** saving notification preferences (`POST api/settings/updatePreferences/v1`)
always fails with `prefs: input nesting exceeds the maximum depth of 64` — the write never lands.

---

## Root cause

`validateType(typeText, value, path, depth)` validates a value against a TypeScript type passed as a
**string**. Its union branch:

```js
if (type.includes("|")) {
  const unionParts = splitTopLevel(type, "|").filter(Boolean);
  if (unionParts.length > 1) {
    for (const unionType of unionParts) {
      const result = validateType(unionType, value, path, depth + 1);
      if (result.status === "success") return result;
    }
    return { status: "error", message: `${path} does not match union type ${type}` };
  }
  if (unionParts.length === 1) {
    return validateType(unionParts[0] ?? type, value, path, depth + 1);   // ← BUG
  }
}
```

`splitTopLevel` only splits at brace/paren/bracket depth 0 — a `|` **inside** `{}` / `()` / `[]` is
NOT a split point (verified: it tracks `depthBrace/depthParen/depthBracket` and only splits when all
are 0). So for an **object type that contains a nested union**, e.g.

```
{ notifyOnAssignment?: undefined | false | true }
```

`type.includes("|")` is `true`, but `splitTopLevel(type, "|")` returns the **whole string as ONE
element** (the pipes are nested in `{}`). That hits the `unionParts.length === 1` branch, which calls
`validateType(unionParts[0] ?? type, …, depth + 1)` where **`unionParts[0] === type`** — the *same
string* — so it recurses with `depth + 1` and no progress, never reaching the object-parsing branch
(which is later in the function), until `depth > MAX_VALIDATION_DEPTH` (64) → returns the depth error.

## Reproduction (standalone, faithful to the 0.3.0 logic)

```
splitTopLevel('{ notifyOnAssignment?: boolean | undefined }', '|')
  → ["{ notifyOnAssignment?: boolean | undefined }"]        // one element — nested pipe not split

validateType('{ notifyOnAssignment?: boolean | undefined }', { notifyOnAssignment: true }, 'prefs')
  → { status: 'error', message: 'prefs: input nesting exceeds the maximum depth of 64' }
  → 66 recursive calls on the identical string
```

## Why it hits this app

The type generator renders an **optional boolean** as `?: undefined | false | true` (optional → adds
`undefined`, `boolean` → `false | true`). So `updatePreferences`'s generated input type is:

```ts
preferences: {
  notifyOnNewSignIn?: undefined | false | true;
  notifyOnPasswordChange?: undefined | false | true;
  notifyOnAssignment?: undefined | false | true
}
```

Those pipes are nested inside the object → the bug fires → the request 400s before `main` runs.

**Scope:** this is NOT specific to preferences. ANY route whose input type contains an object with a
nested union field triggers it — an optional boolean, or any `field: 'a' | 'b'` literal union nested
in an object. (Top-level unions like a bare `boolean | undefined` are fine — those DO split into
length > 1 and validate correctly. It's specifically a union nested inside an object/array/paren.)

## Suggested fix

In the union branch, only treat it as a union when there is a genuine **top-level** union
(`unionParts.length > 1`). When `length <= 1`, the `|` is nested — **fall through** to the
object/record/array parsing instead of recursing on the same string:

```js
if (type.includes("|")) {
  const unionParts = splitTopLevel(type, "|").filter(Boolean);
  if (unionParts.length > 1) {
    for (const unionType of unionParts) {
      const result = validateType(unionType, value, path, depth + 1);
      if (result.status === "success") return result;
    }
    return { status: "error", message: `${path} does not match union type ${type}` };
  }
  // length <= 1: no top-level union (the '|' is nested inside {}/()/[]) — do NOT recurse on the
  // identical string; let the object/record/array branches below handle it.
}
```

(Equivalently: guard the single-part recursion with `unionParts[0] !== type` so it only recurses when
it actually stripped something, e.g. a wrapping/trailing pipe.) After the fix, the object branch
parses the object and validates each field, where `undefined | false | true` IS a top-level union
(length 3) and validates correctly.

**Add a regression test:** `validateType('{ x?: undefined | false | true }', { x: true }, 'p')` must
return `success` (today it errors), and `validateType("{ role: 'a' | 'b' }", { role: 'a' }, 'p')`
likewise.

## Workaround in the consumer app (until fixed)

Set `export const validation = 'relaxed'` on the affected route — `validateInputByType` skips the
string validator, and the route's own allow-list (`updatePreferences_v1.ts` already sanitizes to
booleans) does the checking. This is safe here because the handler re-validates every field.
