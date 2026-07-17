---
name: tojson-describes-the-object-not-the-parent-path
title: An ORM's toJSON() describes stringifying THAT object — not the same object reached through its parent
severity: medium
area: packages/devkit
date: 2026-07-15
tags: [types, orm, serialization, codegen, wontfix]
---

# 0010 — `toJSON()` describes the object, not the path to it

## What happened

The wire projection's RULE 1 is: *a type that declares `toJSON()` serializes as that
method's return type* — because that is what `JSON.stringify` calls. It is derived from
JSON's own contract, holds for `Date`, and is why the generator stopped lying about
dates.

Applied to a MikroORM relation it produced `items: ({ } & { })[]` — vague, and an
obvious candidate for polish. `Collection<T>.toJSON<TT extends T>(): EntityDTO<TT>[]`
plainly says "an array of entity objects", so instantiating `TT` looked like a clean win.

Measuring the actual payload said otherwise. A Collection has **two** serializations, and
they do not agree:

```
JSON.stringify(owner)       -> {"items":["i1","i2"],"name":"Ada","id":"o1"}   // PRIMARY KEYS
JSON.stringify(owner.items) -> [{"label":"first",...},{"label":"second",...}] // OBJECTS
```

`Collection.toJSON()` describes the **second**. A handler returning the entity produces
the **first** — MikroORM's parent serializer emits keys for the collection property and
never calls `Collection.toJSON()` at all.

So rule 1's premise — "stringify calls `toJSON` on this property" — is **false** for a
Collection reached through an entity, which is the normal case. The "precise" type would
have been `EntityDTO<Item>[]`: objects with `.label`, against a wire carrying
`["i1","i2"]`. `items[0].label` would compile and be `undefined` at runtime.

The generator is saved only by an accident: TypeScript exposes no way to instantiate a
generic call signature (`getSignatureInstantiation` / `instantiateType` are absent from
the public API *and* from all 174 runtime methods on the checker, TS 6.0.3), so `TT`
stays unresolved, `EntityDTO<TT>` exposes zero properties, and the result is `{ } & { }`.
A string **is** assignable to `{ }` — so the vague type is accidentally *true*.

## Root cause

`toJSON()`'s signature is a statement about serializing **that object**. It says nothing
about what happens when the object is reached as a **property of a parent** that has its
own serializer — and an ORM's entity serializer is exactly such a parent. The two paths
can legitimately disagree, and MikroORM's do.

Secondary: the wrong framing nearly won twice. First "it's cosmetic, just make it
precise"; then, after a first look, "the divergence is merely wider, not wrong". Both
were plausible, both were reasoned from the `.d.ts`, and only stringifying a live entity
separated them.

## How to avoid

- **When a codegen rule is derived from a runtime contract, verify the runtime actually
  takes that path.** Rule 1 is correct for `Date` (verified: ISO string standalone *and*
  through the entity) and wrong for a Collection-in-an-entity. Same rule, same file,
  different answer — only a payload can tell you which.
- **Vague-but-true beats precise-but-false.** `({ } & { })[]` costs the consumer a
  narrowing step. `EntityDTO<Item>[]` would cost them a production bug that type-checks.
  When you cannot be precise *and* correct, stay wide.
- **A type-level "improvement" is a claim about runtime.** Before tightening a generated
  type, produce the payload it claims to describe.
- **Beware fixes that only work for the ORM in front of you.** Substituting a type
  parameter with its constraint is a guess dressed as a derivation — it equates
  `EntityDTO<TT>` with "TT serialized", which is nowhere in the contract. A name-free
  rule that is really a per-ORM guess is still a per-ORM guess.
- **Record the refutation at the code, not only in a ledger.** The reasoning now sits
  above `resolveToJsonReturnType`, so the next person who spots the "obvious" fix meets
  the measurement before they touch it.

## Related

- `docs/findings/2026-07-15-type-generation/README.md` — T18 (this), T17 (the projection)
- `packages/devkit/src/typeMap/tsProgram.ts` — above `resolveToJsonReturnType`
- [[status-line-is-not-a-handshake]] — same session, same shape: the cheap observable
  (a status line / a `.d.ts` signature) agreed with the belief, and the real payload did not
