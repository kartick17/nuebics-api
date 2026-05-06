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

The user's hard constraint is "no API behaviour change." Keeping `presignPut(key, contentType, expiresIn)`, `presignGet(key, expiresIn)`, `head(key)`, `deleteOne(key)`, `deleteMany(keys[])` means consumer files only need their import + injection-type changed; the call sites are byte-identical. The one shape change is `head`'s return: `{ ContentLength }` → `{ ContentLength, ContentType }` (additive — see "Preserving S3's content-type binding" below).

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
  head(key: string): Promise<{ ContentLength: number; ContentType: string }>;
  deleteOne(key: string): Promise<unknown>;
  deleteMany(keys: string[]): Promise<void>;
}
```

`head` now returns `ContentType` in addition to `ContentLength` — see the §"Preserving S3's content-type binding" subsection below for why.

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
return res.signature;   // SDK type: IStratusPresignedUrlRes — `signature` is the URL
```

The `signature` field naming is confusing — it actually carries the full pre-signed URL. Confirmed by reading `zcatalyst-sdk-node@3.4.0/lib/utils/pojo/stratus.d.ts:204` (`IStratusPresignedUrlRes`).

`contentType` is accepted to keep the signature drop-in, but Stratus's signed URL **does not bind content-type into the signature**. See the next subsection for how we preserve S3's content-type guarantee.

**`presignGet(key, expiresIn = 300)`** — same shape with `'GET'`, returns `res.signature`.

**`head(key)` — uses `getDetails()` for size + content-type**

Stratus's `bucket.headObject(key)` returns only a boolean (no size, no content-type). The right method is `bucket.object(key).getDetails()`, which returns `IStratusObjectDetails` (`zcatalyst-sdk-node@3.4.0/lib/utils/pojo/stratus.d.ts:3-19`):

```ts
{ key, size: number, content_type: string, last_modified: string, version_id?, object_url? }
```

One round-trip gives us everything `confirmUpload` needs:

```ts
async head(key: string): Promise<{ ContentLength: number; ContentType: string }> {
  const details = await this.bucket.object(key).getDetails();
  return { ContentLength: details.size, ContentType: details.content_type };
}
```

If the object doesn't exist, `getDetails()` throws — matching `S3Service.head`'s throw-on-missing semantics. The existing `try/catch` in `files.service.ts:53-57` (returning the `"File not found in S3 — upload may have failed"` 400) continues to fire correctly.

#### Preserving S3's content-type binding

Today's `S3Service.presignPut(key, contentType)` bakes `ContentType: contentType` into the signed URL via `PutObjectCommand`. S3 enforces that the client's PUT must send a matching `Content-Type` header — otherwise the upload is rejected at upload time. There is no explicit check in `confirmUpload`; the binding is implicit in S3's signed-URL semantics.

Stratus's signed URL has no such binding, so a malicious client could PUT bytes with any `Content-Type` header (or none) and the object would store the client's chosen type. To restore parity, we shift enforcement from upload-time to confirm-time: `head()` now returns the stored `content_type`, and `files.service.ts` adds a content-type equality check next to the existing size check.

**Change in `files.service.ts:confirmUpload`** (additive, after the existing size check):

```ts
if (headResult.ContentType !== fileType) {
  await this.s3.deleteOne(key);          // post-rename: this.stratus.deleteOne(key)
  return { error: 'Upload content type mismatch', status: 400 } as const;
}
```

User-visible parity: with S3, a client sending the wrong `Content-Type` would get 403 from S3 on the PUT. With Stratus, they succeed at PUT but get 400 + orphan cleanup at `/files/confirm`. The end-state guarantee — "you cannot end up with a stored file whose type differs from the one you claimed at /files/upload" — is preserved.

This adds **one new error path** to `/files/confirm` (HTTP 400 with body `{ error: 'Upload content type mismatch' }`). The user accepted this in the design discussion as the only way to keep security parity.

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
| `src/files/files.service.ts` | `import { S3Service } from '../shared/s3/s3.service'` → `StratusService` from `../shared/stratus/stratus.service`. Rename injected field `s3` → `stratus`; update the four call sites. **Add content-type equality check in `confirmUpload` (delete orphan + 400 on mismatch).** |
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

## Data flow

```
Client                         API                            Stratus
  |                              |                               |
  |---- POST /files/upload ----->|                               |
  |                              |-- generatePreSignedUrl(PUT) ->|
  |<--- {presignedUrl, key} -----|<--- {signature, ...} ---------|
  |                              |                               |
  |---- PUT <presignedUrl> ---------------------------------> Stratus
  |  (with Content-Type: <fileType> header — same as today)      |
  |                              |                               |
  |---- POST /files/confirm ---->|                               |
  |                              |-- object(key).getDetails() -->|
  |                              |<--- {size, content_type, ...} |
  |                              | check size == fileSize        |
  |                              | check content_type == fileType|
  |                              | (else deleteObject + 400)     |
  |<--- 201 {file} --------------|                               |
```

`/files/download/:id` and `/files/download` (batch) call `presignGet` exactly as before — only the underlying SDK changes.

## Error handling

| Condition | Behaviour |
|-----------|-----------|
| Object missing on `head` | `StratusService.head` throws → existing `try/catch` returns 400 with the unchanged `"File not found in S3 — upload may have failed"` message. |
| Size mismatch on confirm | Existing path: `deleteOne(key)` + 400 `"Upload appears incomplete — please try again"`. Unchanged. |
| Content-type mismatch on confirm | **New path**: `deleteOne(key)` + 400 `"Upload content type mismatch"`. Restores S3's implicit binding (S3 would have rejected the PUT itself; Stratus rejects at confirm). |
| Stratus SDK error during presign / delete | Propagates → Nest returns 500 (same as today's S3 errors). |
| Invalid Zoho credentials at boot | Constructor or first SDK call throws → process fails fast at startup; no fallback to S3. |

## Testing

- **`folders.helpers.spec.ts`**: only the mock provider type changes (`S3Service` → `StratusService`). The mock shape (`{ deleteMany: async () => undefined }`) is unchanged. No new specs are added — consumer behaviour is unchanged from their POV.
- No new mock infrastructure (`aws-sdk-client-mock` stays unused but installed; the S3 files still depend on it).
- Manual verification post-merge:
  1. `POST /files/upload` returns a `presignedUrl` whose host is the Stratus endpoint.
  2. `PUT` to that URL with a small file and `Content-Type: <fileType>` header succeeds.
  3. `POST /files/confirm` returns 201 and the file row appears in Mongo.
  4. `POST /files/confirm` with a tampered `fileSize` returns 400 (`"Upload appears incomplete — please try again"`) and the orphan object is deleted.
  5. **NEW**: `PUT` with a wrong `Content-Type` header (e.g. claim `image/png` at /upload, send `Content-Type: text/html` on PUT) → `POST /files/confirm` returns 400 (`"Upload content type mismatch"`) and the orphan object is deleted.
  6. `GET /files/download/:id` returns a Stratus presigned GET URL that resolves to the bytes.
  7. Folder delete (`folders.helpers.deleteFolderRecursive`) removes objects from Stratus.
  8. Trash purge cron (`purgeExpiredTrash`) removes objects from Stratus.

## Rollback

To revert to S3:
1. In `src/app.module.ts`, replace `StratusModule` with `S3Module`.
2. In each consumer, revert the `StratusService` import + injected field type back to `S3Service`, and rename the field back from `stratus` → `s3` so the call sites compile.
3. In `files.service.ts:confirmUpload`, **remove the content-type mismatch branch** (S3's signed URL binds content-type at upload-time, so the confirm-time check is redundant under S3). The size check stays.

(Method signatures, call-site arguments, and return shapes are unchanged because the surfaces are identical — except `head` now returns `{ ContentLength, ContentType }` instead of `{ ContentLength }`. Reverting the `S3Service` is fine: TypeScript will complain about the unused `ContentType` reference once the content-type check is removed in step 3.)

No data migration is required for rollback because the swap doesn't move any objects between buckets — that's a separate effort outside this spec.

## Out of scope (explicit)

- Migrating existing S3 objects into Stratus.
- Removing the dormant S3 code or its dependencies.
- Changing the error string `"File not found in S3 — upload may have failed"`.
- Adding a feature flag / dual-mode dispatcher (`StratusModule` is the only registered storage module; rollback is a single import swap).
- Frontend coordination — no contract changes. (The frontend already sends `Content-Type: <fileType>` on the S3 PUT today, so the new content-type check at `/files/confirm` will pass for legitimate clients with no client-side change.)
