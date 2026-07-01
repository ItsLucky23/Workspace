# Skill: audit-error-code-coverage

Cross-check every `errorCode` returned from `src/**/_api/*.ts` and `src/**/_sync/*.ts` against the locale JSON files under `src/_locales/`. Flag missing translation keys — those produce ugly fallback strings (or the raw code) in the user's notify toasts.

## When to use

- Before any release that adds new error responses.
- After a bulk locale file edit — easy to delete a key by accident.
- As part of i18n maintenance reviews.

## Workflow

### 1. Discover all errorCode usages

Grep with pattern `errorCode:\s*['"]([^'"]+)['"]` across `src/**/_api/**` and `src/**/_sync/**`. Collect every unique value into a `Set<string>`.

Skip values that look templated (`errorCode: 'thing.' + name`) — those can't be statically resolved. Log them separately under a "DYNAMIC" bucket.

### 2. Discover locale files

Glob `src/_locales/*.json`. For each, parse as JSON. Track which language file we're checking — default to `en` as the canonical source-of-truth (other languages should match en's key set).

### 3. Check coverage

For each `errorCode` discovered in step 1, verify it resolves to a leaf key in the locale JSON. errorCodes use dot notation, e.g. `api.invalidInputType` → look up `locale.api.invalidInputType`.

For each language file, build two lists:

- **Missing**: errorCodes used in source but NOT present in this language's locale → user sees the raw code in toasts.
- **Orphaned**: keys in the locale that are NOT referenced from any source file → dead translations, candidates for removal.

### 4. Report

```
[audit-error-code-coverage]
  Locale: en (canonical source-of-truth)
    MISSING in en (3):
      auth.tooManyAttempts          (used in src/auth/_api/login_v1.ts:42)
      billing.invoiceLocked         (used in src/billing/_api/getInvoice_v1.ts:18)
      sync.roomNotFound             (used in src/chat/_sync/joinRoom_server_v1.ts:55)

    ORPHANED in en (2):
      legacy.oldFlowError           (no source references)
      debug.testKey                 (no source references — likely test scaffolding)

  Locale: nl (compared against en)
    MISSING in nl, present in en (5):
      api.invalidInputType
      api.rateLimitExceeded
      auth.notLoggedIn
      ...

  DYNAMIC (1):
    src/billing/_api/createInvoice_v1.ts:33  errorCode: `billing.${reason}` (cannot statically verify)
```

### 5. Offer fixes

For MISSING keys in the canonical language (en), suggest adding stub translations:

```json
{
  "auth": {
    "tooManyAttempts": "Too many login attempts. Please wait a minute and try again."
  }
}
```

Generate per-locale-file patches. Apply via Edit only on user confirmation. **Default the new translation to en's value verbatim** for non-canonical languages — better an English fallback than a broken key.

For ORPHANED keys, list them but **do not auto-remove**. Some keys might be used in `useTranslator({ key: ... })` calls outside `_api`/`_sync` that this skill doesn't scan.

## Example finding + correction

```
billing.invoiceLocked → MISSING in src/_locales/en.json
```

Suggested patch:

```diff
   "billing": {
     "invoiceCreated": "Invoice created successfully.",
+    "invoiceLocked": "This invoice is locked and cannot be edited.",
     ...
   }
```

After adding to en, also patch every non-en file with a copy of the en text (developers can localize later).

## Not in scope

- `useTranslator({ key: ... })` calls in React components aren't scanned in this skill — focus is on API/sync error codes specifically. A separate skill could expand the scope.
- The skill doesn't VALIDATE that translations are accurate, just that the key exists. Quality of i18n is a human review concern.
