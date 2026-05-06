# Zoho Stratus migration — design

**Status:** Approved for planning
**Date:** 2026-05-06
**Owner:** kartick17

## Goal

Migrate the live object-storage backend from AWS S3 to Zoho Catalyst Stratus without changing any HTTP contract (routes, request bodies, response shapes, status codes). The existing S3 code stays on disk, unwired, so a rollback is a one-line `AppModule` swap.

## Non-goals

- No controller, DTO, or response shape changes.
- No removal of `@aws-sdk/*` deps, `aws-sdk-client-mock`, the S3 source files, or `AWS_*` env vars.
- No change to user-facing error strings (e.g., the `"File not found in S3 — upload may have failed"` message is preserved verbatim).
- No frontend changes. The presigned-URL upload flow remains unchanged from the client's view.

## Background

`S3Service` (`src/shared/s3/s3.service.ts`) is a global Nest provider used by:

- `src/files/files.service.ts` — `presignPut`, `head`, `deleteOne`, `presignGet`
- `src/files/download.controller.ts` — `presignGet`
- `src/folders/folders.helpers.ts` — `deleteMany`
- `src/folders/folders.helpers.spec.ts` — mock target

The flow today: client requests `/files/upload`, server returns a presigned PUT URL + storage key; client PUTs the object directly to S3; client calls `/files/confirm` with the key, the server `HEAD`s the object and rejects the upload if `ContentLength !== fileSize` (deleting the orphan), otherwise writes the file row.

## Approach

Add a new global `StratusModule` whose `StratusService` exposes the **same method signatures** as `S3Service`, so consumers swap with a single-line import change. `AppModule` imports `StratusModule` instead of `S3Module`. The S3 files stay on disk for rollback but are no longer registered with the Nest DI graph.

### Why mirror the S3Service surface

The user's hard constraint is "no API behaviour change." Keeping `presignPut(key, contentType, expiresIn)`, `presignGet(key, expiresIn)`, `head(key) → { ContentLength }`, `deleteOne(key)`, `deleteMany(keys[])` means consumer files only need their import + injection-type changed; the call sites are byte-identical.

### Why use the Catalyst SDK and not REST

The user has already committed `ZOHO_CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/PROJECT_ID/PROJECT_KEY/ENVIRONMENT/BUCKET_NAME` plus the India DC overrides (`X_ZOHO_CATALYST_ACCOUNTS_URL`, `X_ZOHO_CATALYST_CONSOLE_URL`, `X_ZOHO_STRATUS_RESOURCE_SUFFIX`) in `.env`. These are exactly the inputs the official `zcatalyst-sdk-node` package consumes. Using the SDK avoids hand-rolling OAuth refresh, signing, retry, and DC routing.

## Components

### New files

```
src/shared/stratus/
  stratus.module.ts
  stratus.service.ts
```

#### `stratus.module.ts`

Mirrors `s3.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { StratusService } from './stratus.service';

@Global()
@Module({
  providers: [StratusService],
  exports: [StratusService],
})
export class StratusModule {}
```

#### `stratus.service.ts` — public surface

```ts
class StratusService {
  presignPut(key: string, contentType: string, expiresIn = 300): Promise<string>;
  presignGet(key: string, expiresIn = 300): Promise<string>;
  head(key: string): Promise<{ ContentLength: number }>;
  deleteOne(key: string): Promise<unknown>;
  deleteMany(keys: string[]): Promise<void>;
}
```

#### `stratus.service.ts` — internals

**Constructor (init once):**

```ts
import * as catalyst from 'zcatalyst-sdk-node';

constructor(config: ConfigService<Env, true>) {
  const credential = catalyst.credential.refreshToken({
    client_id: config.get('ZOHO_CLIENT_ID', { infer: true }),
    client_secret: config.get('ZOHO_CLIENT_SECRET', { infer: true }),
    refresh_token: config.get('ZOHO_REFRESH_TOKEN', { infer: true }),
  });

  const app = catalyst.initializeApp({
    project_id: config.get('ZOHO_PROJECT_ID', { infer: true }),
    project_key: config.get('ZOHO_PROJECT_KEY', { infer: true }),
    environment: config.get('ZOHO_ENVIRONMENT', { infer: true }),
    credential,
  });

  this.bucket = app.stratus().bucket(config.get('ZOHO_BUCKET_NAME', { infer: true }));
}
```

The `X_ZOHO_CATALYST_ACCOUNTS_URL`, `X_ZOHO_CATALYST_CONSOLE_URL`, and `X_ZOHO_STRATUS_RESOURCE_SUFFIX` overrides are read by the SDK directly from `process.env`, so they are not threaded through `ConfigService`.

**`presignPut(key, contentType, expiresIn = 300)`**

```ts
const res = await this.bucket.generatePreSignedUrl(key, 'PUT', { expiryIn: expiresIn });
return extractUrl(res);
```

`contentType` is accepted to keep the signature drop-in, but Stratus does not bind the content-type into the signed URL. The frontend may still send `Content-Type: <fileType>` on its PUT — Stratus does not reject mismatches.

> **Implementation note — URL field name:** `generatePreSignedUrl` returns an object whose URL field name is not documented verbatim by Zoho (docs only describe a "signed URL object containing the signature parameter"). The implementer should `console.log` the response shape during the first integration run and use the actual field (e.g. `res.signature` / `res.url` / `res.signed_url`). If the response is a string, return it directly. This affects both `presignPut` and `presignGet`.

**`presignGet(key, expiresIn = 300)`** — same shape with `'GET'`.

**`head(key)` — preserves the size-mismatch check**

Stratus's `bucket.headObject(key)` returns a boolean (existence/permission) and exposes no size, so it cannot back the existing `ContentLength !== fileSize` validation. To preserve that behaviour we read the latest version via the object instance:

```ts
async head(key: string): Promise<{ ContentLength: number }> {
  const obj = this.bucket.object(key);
  const versions = obj.listIterableVersions();
  for await (const v of versions) {
    if (v.is_latest) return { ContentLength: Number(v.size) };
  }
  throw new Error('Object not found');
}
```

The throw matches `S3Service.head`'s throw-on-missing semantics, so the existing `try/catch` in `files.service.ts:53-57` (returning the `"File not found in S3 — upload may have failed"` 400) continues to fire correctly.

**`deleteOne(key)`** → `this.bucket.deleteObject(key)`.

**`deleteMany(keys[])`** — same 1000-batch loop as today, but using Stratus:

```ts
async deleteMany(keys: string[]) {
  if (keys.length === 0) return;
  const BATCH = 1000;
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH);
    await this.bucket.deleteObjects(chunk.map(key => ({ key })));
  }
}
```

### Edited files

| File | Change |
|------|--------|
| `src/app.module.ts` | Replace `S3Module` import with `StratusModule`. |
| `src/files/files.service.ts` | `import { S3Service } from '../shared/s3/s3.service'` → `StratusService` from `../shared/stratus/stratus.service`. Rename injected field `s3` → `stratus`; update the four call sites. |
| `src/files/download.controller.ts` | Same import + injection swap; update the two `presignGet` call sites. |
| `src/folders/folders.helpers.ts` | Same swap; update the two `deleteMany` call sites. |
| `src/folders/folders.helpers.spec.ts` | Replace `{ provide: S3Service, useValue: { deleteMany: async () => undefined } }` with the equivalent `StratusService` provide. Update the import. |
| `src/config/env.validation.ts` | Add the seven `ZOHO_*` keys (see below). Keep all `AWS_*` keys. |
| `package.json` / `yarn.lock` | Add `zcatalyst-sdk-node` (latest v2). |

### Env schema additions (`env.validation.ts`)

```ts
ZOHO_CLIENT_ID: z.string().min(1),
ZOHO_CLIENT_SECRET: z.string().min(1),
ZOHO_REFRESH_TOKEN: z.string().min(1),
ZOHO_PROJECT_ID: z.string().min(1),
ZOHO_PROJECT_KEY: z.string().min(1),
ZOHO_ENVIRONMENT: z.enum(['Development', 'Production']),
ZOHO_BUCKET_NAME: z.string().min(1),
```

The DC override vars (`X_ZOHO_CATALYST_*`, `X_ZOHO_STRATUS_RESOURCE_SUFFIX`) are read by the SDK directly from `process.env` and are not part of our application-level config.

## Data flow (unchanged)

```
Client                         API                            Stratus
  |                              |                               |
  |---- POST /files/upload ----->|                               |
  |                              |-- generatePreSignedUrl(PUT) ->|
  |<--- {presignedUrl, key} -----|<------------- url ------------|
  |                              |                               |
  |---- PUT <presignedUrl> ---------------------------------> Stratus
  |                              |                               |
  |---- POST /files/confirm ---->|                               |
  |                              |-- listIterableVersions() ---->|
  |                              |<--- [{size, is_latest, ...}] -|
  |                              | check size == fileSize        |
  |                              | (else deleteObject + 400)     |
  |<--- 201 {file} --------------|                               |
```

`/files/download/:id` and `/files/download` (batch) call `presignGet` exactly as before — only the underlying SDK changes.

## Error handling

| Condition | Behaviour |
|-----------|-----------|
| Object missing on `head` | `StratusService.head` throws → existing `try/catch` returns 400 with the unchanged `"File not found in S3 — upload may have failed"` message. |
| Stratus SDK error during presign / delete | Propagates → Nest returns 500 (same as today's S3 errors). |
| Invalid Zoho credentials at boot | Constructor or first SDK call throws → process fails fast at startup; no fallback to S3. |

## Testing

- **`folders.helpers.spec.ts`**: only the mock provider type changes (`S3Service` → `StratusService`). The mock shape (`{ deleteMany: async () => undefined }`) is unchanged. No new specs are added — consumer behaviour is unchanged from their POV.
- No new mock infrastructure (`aws-sdk-client-mock` stays unused but installed; the S3 files still depend on it).
- Manual verification post-merge:
  1. `POST /files/upload` returns a `presignedUrl` whose host is the Stratus endpoint.
  2. `PUT` to that URL with a small file succeeds.
  3. `POST /files/confirm` returns 201 and the file row appears in Mongo.
  4. `POST /files/confirm` with a tampered `fileSize` returns 400 and the orphan object is deleted.
  5. `GET /files/download/:id` returns a Stratus presigned GET URL that resolves to the bytes.
  6. Folder delete (`folders.helpers.deleteFolderRecursive`) removes objects from Stratus.
  7. Trash purge cron (`purgeExpiredTrash`) removes objects from Stratus.

## Rollback

To revert to S3:
1. In `src/app.module.ts`, replace `StratusModule` with `S3Module`.
2. In each consumer, revert the `StratusService` import + injected field type back to `S3Service`, and rename the field back from `stratus` → `s3` so the call sites compile. (Method signatures, call-site arguments, and return shapes are unchanged because the surfaces are identical.)

No data migration is required for rollback because the swap doesn't move any objects between buckets — that's a separate effort outside this spec.

## Out of scope (explicit)

- Migrating existing S3 objects into Stratus.
- Removing the dormant S3 code or its dependencies.
- Changing the error string `"File not found in S3 — upload may have failed"`.
- Adding a feature flag / dual-mode dispatcher (`StratusModule` is the only registered storage module; rollback is a single import swap).
- Frontend coordination — no contract changes.
