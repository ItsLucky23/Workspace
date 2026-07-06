//? Workspaces — coerce typed, JSON-safe domain data into a Prisma Json-column input.
//? A domain interface (e.g. `SecurityFinding`, `ReviewFinding`) carries no index signature, so
//? `Prisma.InputJsonValue` refuses it even though every field is valid JSON. A deep clone widens it to
//? a structural value the client accepts — and, being a copy, is also safe to store. Use this at the
//? write site instead of casting (`as any` / `as unknown as`), which the type contract forbids.

import type { Prisma } from '@prisma/client';

export function jsonInput(value: unknown): Prisma.InputJsonValue {
  const json: unknown = structuredClone(value ?? null);
  return json as Prisma.InputJsonValue;
}
