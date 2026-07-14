---
name: validatetype-union-depth-false-positive
title: A nested union in a route's input type made runtime validation reject ALL input with a bogus depth error
severity: high
area: packages/core (runtimeTypeValidation)
date: 2026-07-02
tags: [runtime, validation, type-text, production]
---

# 0002 — A nested union in a route's input type made runtime validation reject ALL input

## What happened

Every per-route test for a route whose input type contained a union (e.g. `theme?: 'dark' | 'light'`) failed with `api.invalidInputType`, even on the happy path with a perfectly valid, shallow payload like `{ name: 'New Name' }`. The server log showed `data: input nesting exceeds the maximum depth of 64` — for a depth-1 value. The generated Zod schema was correct and the devkit resolver produced a shallow type text (bracket depth 1), so nothing looked wrong until the structural validator itself was traced.

## Root cause

`validateType` (packages/core/src/runtimeTypeValidation.ts) entered its union branch whenever `type.includes('|')` was true — which is true for an OBJECT type text like `{ name?: undefined | string; theme?: undefined | 'dark' | 'light' }`, because the `|` lives INSIDE the properties. `splitTopLevel(type, '|')` correctly found no TOP-LEVEL `|` and returned the whole type as a single part, but the `unionParts.length === 1` branch then recursed with `validateType(unionParts[0], value, path, depth + 1)` where `unionParts[0] === type` — i.e. it recursed on the IDENTICAL string, incrementing `depth` each pass until `MAX_VALIDATION_DEPTH` (64) tripped. The depth guard exists to bound attacker VALUE nesting (stack DoS), but it was being consumed by a self-recursion on type SYNTAX. Because `validation.runtimeMode` defaults to `'enforce'` (0.2.0), this rejected valid input in **production** too, not just the tests — any route with a union anywhere in its input type was un-callable.

## How to avoid

The single-member union recursion must only happen when `splitTopLevel` actually isolated a DIFFERENT sub-type (a trimmed leading/trailing `|`, or a stripped paren) — `unionParts.length === 1 && singleMember !== type`. When the single part equals the whole type, there is no top-level union; fall through to the object/array/primitive handling instead of recursing. Regression test: `runtimeTypeValidation.test.ts` — "accepts a shallow value against an object type whose properties contain nested unions". General takeaway: a "max depth exceeded" on a shallow value is almost never real nesting — suspect a recursion that doesn't consume input. And run the per-route (`*.tests.ts`) suite against a live server after any change to input types or the validator; `npx vitest run` does NOT exercise the HTTP validation path.
