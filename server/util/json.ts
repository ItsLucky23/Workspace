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

//? The same boundary, narrowed to an OBJECT input — for `$runCommandRaw`, whose parameter type
//? refuses the wider `InputJsonValue` (a raw Mongo command is always a document).
export function jsonInputObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const json: unknown = structuredClone(value);
  return json as Prisma.InputJsonObject;
}
