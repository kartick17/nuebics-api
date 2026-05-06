# Zoho Stratus Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AWS S3 as the live object-storage backend with Zoho Catalyst Stratus, without changing any HTTP contract. Existing S3 code stays on disk for rollback.

**Architecture:** New global `StratusModule` (`src/shared/stratus/`) provides a `StratusService` whose method surface mirrors `S3Service` (same names + arg order; `head` extends its return shape from `{ ContentLength }` → `{ ContentLength, ContentType }`). `AppModule` swaps `S3Module` → `StratusModule`. Four consumer files swap `S3Service` → `StratusService` and rename the injected field `s3` → `stratus`. `files.service.ts:confirmUpload` gains a content-type equality check next to its existing size check, restoring S3's implicit content-type binding (which Stratus signed URLs do not provide).

**Tech Stack:** NestJS 11, TypeScript 5.7, `zcatalyst-sdk-node@^3.4.0`, Zod env validation, Jest, Yarn.

**Reference spec:** `docs/superpowers/specs/2026-05-06-zoho-stratus-migration-design.md` — read first.

**Pre-existing env vars** (already in `.env`, must not be removed): `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_PROJECT_ID`, `ZOHO_PROJECT_KEY`, `ZOHO_ENVIRONMENT`, `ZOHO_BUCKET_NAME`, `ZOHO_ACCOUNTS_URL`, `X_ZOHO_CATALYST_ACCOUNTS_URL`, `X_ZOHO_CATALYST_CONSOLE_URL`, `X_ZOHO_STRATUS_RESOURCE_SUFFIX`. The SDK reads `X_ZOHO_CATALYST_*` and `X_ZOHO_STRATUS_RESOURCE_SUFFIX` directly from `process.env`; the rest are validated via Zod and consumed via `ConfigService`.

**Testing approach:** The spec disclaimed new unit specs because the consumer-visible behavior is unchanged. So the verification gate at every task is:
- `yarn tsc --noEmit` (or `yarn build` if it implies tsc) — type-check
- `yarn lint` — lint
- `yarn test` — existing Jest specs still pass
- Manual smoke at the end (item list under "Task 11 — Manual smoke verification")

If `yarn` is not the right runner in your shell session, fall back to `npm run`.

---

## File Structure

**New files:**
- `src/shared/stratus/stratus.module.ts` — Global Nest module exporting `StratusService`.
- `src/shared/stratus/stratus.service.ts` — Stratus-backed implementation of the `S3Service`-shaped surface.

**Modified files:**
- `src/config/env.validation.ts` — add 7 `ZOHO_*` keys to the Zod schema.
- `src/app.module.ts` — replace `S3Module` import with `StratusModule`.
- `src/files/files.service.ts` — swap `S3Service` → `StratusService`, rename field `s3` → `stratus`, add content-type equality check in `confirmUpload`.
- `src/files/download.controller.ts` — swap `S3Service` → `StratusService`, rename field `s3` → `stratus`.
- `src/folders/folders.helpers.ts` — swap `S3Service` → `StratusService`, rename field `s3` → `stratus`.
- `src/folders/folders.helpers.spec.ts` — update mock provider type (`S3Service` → `StratusService`), seed `ZOHO_*` env vars in `beforeAll`.
- `package.json` / `yarn.lock` — add `zcatalyst-sdk-node`.

**Untouched (intentionally):**
- `src/shared/s3/s3.module.ts` — stays on disk, but no longer imported by `AppModule`.
- `src/shared/s3/s3.service.ts` — stays on disk.
- `AWS_*` env vars in `.env` and `env.validation.ts` — stay valid.
- `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `aws-sdk-client-mock` deps — stay in `package.json` (the dormant S3 files still reference them).

---

## Task 1: Add `ZOHO_*` keys to the Zod env schema

**Files:**
- Modify: `src/config/env.validation.ts`

The existing schema validates only `AWS_*` storage keys. We add `ZOHO_*` keys without removing AWS ones, so both implementations remain bootable.

- [ ] **Step 1: Open the file and verify current schema**

Read `src/config/env.validation.ts`. The current schema (around line 13–19) lists `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, plus `MAX_FILES`, `CRON_SECRET`. We will add the new `ZOHO_*` block right below the AWS block.

- [ ] **Step 2: Insert the `ZOHO_*` keys**

Use Edit to add this block immediately after the line `AWS_S3_BUCKET_NAME: z.string().min(1),`:

```ts
ZOHO_CLIENT_ID: z.string().min(1),
ZOHO_CLIENT_SECRET: z.string().min(1),
ZOHO_REFRESH_TOKEN: z.string().min(1),
ZOHO_PROJECT_ID: z.string().min(1),
ZOHO_PROJECT_KEY: z.string().min(1),
ZOHO_ENVIRONMENT: z.enum(['Development', 'Production']),
ZOHO_BUCKET_NAME: z.string().min(1),
```

The `Env` type re-derives from the schema automatically — no other change needed in this file.

- [ ] **Step 3: Type-check**

Run: `yarn tsc --noEmit`
Expected: PASS, no errors. (At this point no consumer references the new keys yet, so it's a pure schema addition.)

- [ ] **Step 4: Commit**

```bash
git add src/config/env.validation.ts
git commit -m "feat(env): add ZOHO_* keys to Zod schema for Stratus migration"
```

---

## Task 2: Seed `ZOHO_*` env vars in `folders.helpers.spec.ts`

**Files:**
- Modify: `src/folders/folders.helpers.spec.ts`

This spec calls `validateEnv` via `ConfigModule.forRoot({ ... validate: validateEnv })`. With Task 1's new required keys, the spec will fail at boot unless we seed dummy values. (Same pattern the file already uses for `AWS_*` keys.)

- [ ] **Step 1: Read the current `beforeAll` block**

Read `src/folders/folders.helpers.spec.ts` lines 28–47. Note the `process.env.X ||= 'y';` lines that seed required env vars before the testing module is created.

- [ ] **Step 2: Add `ZOHO_*` seeds**

Use Edit to insert these lines immediately after `process.env.AWS_S3_BUCKET_NAME ||= 'x';` (and before `process.env.CRON_SECRET ||= 'x';`):

```ts
    process.env.ZOHO_CLIENT_ID ||= 'x';
    process.env.ZOHO_CLIENT_SECRET ||= 'x';
    process.env.ZOHO_REFRESH_TOKEN ||= 'x';
    process.env.ZOHO_PROJECT_ID ||= 'x';
    process.env.ZOHO_PROJECT_KEY ||= 'x';
    process.env.ZOHO_ENVIRONMENT ||= 'Development';
    process.env.ZOHO_BUCKET_NAME ||= 'x';
```

- [ ] **Step 3: Run the affected spec**

Run: `yarn test src/folders/folders.helpers.spec.ts`
Expected: PASS — all three `isDescendantOf` cases.

If it fails with a Zod validation error, double-check the seeded keys match the schema names exactly.

- [ ] **Step 4: Commit**

```bash
git add src/folders/folders.helpers.spec.ts
git commit -m "test(folders): seed ZOHO_* env vars to satisfy validator"
```

---

## Task 3: Install `zcatalyst-sdk-node`

**Files:**
- Modify: `package.json`, `yarn.lock`

- [ ] **Step 1: Add the dependency**

Run: `yarn add zcatalyst-sdk-node`
Expected: yarn resolves the latest 3.x (≥ 3.4.0). The spec was authored against 3.4.0; 3.x patch/minor upgrades should be source-compatible for the methods used (`generatePreSignedUrl`, `bucket.object().getDetails()`, `deleteObject`, `deleteObjects`, `credential.refreshToken`, `initializeApp`, `app.stratus().bucket(name)`).

If yarn picks up a 4.x major, **stop** and pin to `^3.4.0` instead:
```bash
yarn add zcatalyst-sdk-node@^3.4.0
```

- [ ] **Step 2: Verify install**

Run: `node -e "console.log(require('zcatalyst-sdk-node').credential ? 'ok' : 'missing credential namespace')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "chore(deps): add zcatalyst-sdk-node for Stratus migration"
```

---

## Task 4: Create `StratusModule`

**Files:**
- Create: `src/shared/stratus/stratus.module.ts`

- [ ] **Step 1: Create the module file**

Use Write to create `src/shared/stratus/stratus.module.ts`:

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

This mirrors `src/shared/s3/s3.module.ts` exactly except for the names.

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit`
Expected: FAIL — `Cannot find module './stratus.service'` (we haven't written it yet). This is fine; Task 5 fixes it. **Do not commit yet.**

---

## Task 5: Create `StratusService` (constructor + all five methods)

**Files:**
- Create: `src/shared/stratus/stratus.service.ts`

This is the heart of the migration. Per the spec (§"`stratus.service.ts` — internals" and §"Preserving S3's content-type binding"), we mirror the `S3Service` surface and use `bucket.object(key).getDetails()` to back `head()`.

- [ ] **Step 1: Write the service file**

Use Write to create `src/shared/stratus/stratus.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as catalyst from 'zcatalyst-sdk-node';
import type { Env } from '../../config/env.validation';

@Injectable()
export class StratusService {
  private readonly bucket: ReturnType<ReturnType<ReturnType<typeof catalyst.initializeApp>['stratus']>['bucket']>;

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

  async presignPut(key: string, _contentType: string, expiresIn = 300): Promise<string> {
    const res = await this.bucket.generatePreSignedUrl(key, 'PUT', { expiryIn: String(expiresIn) });
    if (!res?.signature) throw new Error('Stratus did not return a signed URL');
    return res.signature;
  }

  async presignGet(key: string, expiresIn = 300): Promise<string> {
    const res = await this.bucket.generatePreSignedUrl(key, 'GET', { expiryIn: String(expiresIn) });
    if (!res?.signature) throw new Error('Stratus did not return a signed URL');
    return res.signature;
  }

  async head(key: string): Promise<{ ContentLength: number; ContentType: string }> {
    const details = await this.bucket.object(key).getDetails();
    return { ContentLength: Number(details.size), ContentType: details.content_type };
  }

  deleteOne(key: string) {
    return this.bucket.deleteObject(key);
  }

  async deleteMany(keys: string[]) {
    if (keys.length === 0) return;
    const BATCH = 1000;
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH);
      await this.bucket.deleteObjects(chunk.map((key) => ({ key })));
    }
  }
}
```

Notes:
- `_contentType` is intentionally underscore-prefixed in `presignPut`. Stratus signed URLs do not bind content-type; the parameter exists only for API parity with `S3Service.presignPut(key, contentType, expiresIn)` so consumer call sites need no rewrite. (TypeScript / ESLint may still warn on the unused param. If the project's ESLint config flags this, leave the underscore prefix in place — that's the convention `eslint.config.mjs` should already permit. If lint fails, set `argsIgnorePattern: "^_"` in the local override or just rename the parameter `contentType` and add an `// eslint-disable-next-line @typescript-eslint/no-unused-vars` line above.)
- The `bucket` private field type is derived via three nested `ReturnType` calls so we don't need to import the SDK's internal `Bucket` type. If TypeScript complains because `catalyst` has no callable signatures or union return shapes, fall back to `private readonly bucket: any;` — pragmatic, and the SDK's TypeScript surface is the only thing we lose.
- `getDetails().size` is typed as `number` per `IStratusObjectDetails` (`zcatalyst-sdk-node@3.4.0/lib/utils/pojo/stratus.d.ts:9`), but we wrap in `Number(...)` defensively because related shapes (e.g. `IStratusObjectVersionDetails.size`) are `string`.
- `expiryIn` is documented as a string in the SDK's options type, hence `String(expiresIn)`.

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit`
Expected: PASS.

If you hit type errors on the `bucket` field declaration, replace its type annotation with `any` (see notes above) and proceed. We accept this small loss of IDE typing in exchange for not depending on internal SDK types.

- [ ] **Step 3: Lint**

Run: `yarn lint`
Expected: PASS, no errors. If `_contentType` is flagged, see the parameter note in Step 1.

- [ ] **Step 4: Commit**

```bash
git add src/shared/stratus/stratus.module.ts src/shared/stratus/stratus.service.ts
git commit -m "feat(stratus): add StratusModule + StratusService mirroring S3Service surface"
```

---

## Task 6: Wire `StratusModule` into `AppModule` (replace `S3Module`)

**Files:**
- Modify: `src/app.module.ts`

This is the cutover: after this task, the app boots with Stratus as its storage backend. Consumers still inject `S3Service`, so DI will fail at boot from this point until Tasks 7–9 swap them. Do **not** start the dev server between tasks — wait until Task 11.

- [ ] **Step 1: Replace the import line**

In `src/app.module.ts`, find:

```ts
import { S3Module } from './shared/s3/s3.module';
```

Replace with:

```ts
import { StratusModule } from './shared/stratus/stratus.module';
```

- [ ] **Step 2: Replace it in the `imports` array**

In the `@Module({ imports: [...] })` array (around line 28), replace `S3Module` with `StratusModule`.

- [ ] **Step 3: Type-check**

Run: `yarn tsc --noEmit`
Expected: FAIL — consumers (`files.service.ts`, `download.controller.ts`, `folders.helpers.ts`) still reference `S3Service`, but `S3Module` is no longer in the DI graph. Nest's DI failure happens at runtime, not compile time, so the type-checker may still pass; that's fine. **Do not commit yet** — fold this with Task 7's commit so the repo never has an intermediate broken state.

If you prefer to commit incrementally, you may, but expect failing app boot until Task 9.

---

## Task 7: Swap `S3Service` → `StratusService` in `files.service.ts` (+ add content-type check)

**Files:**
- Modify: `src/files/files.service.ts`

This is the largest consumer change because it also adds the new content-type equality check in `confirmUpload`.

- [ ] **Step 1: Update the import**

Find the line:
```ts
import { S3Service } from '../shared/s3/s3.service';
```
Replace with:
```ts
import { StratusService } from '../shared/stratus/stratus.service';
```

- [ ] **Step 2: Update the constructor field type and name**

In the constructor parameter list, find:
```ts
private readonly s3: S3Service,
```
Replace with:
```ts
private readonly stratus: StratusService,
```

- [ ] **Step 3: Update the four call sites**

The class has four references to `this.s3.*`. Update each:

- Line ~40 (`presignUpload`):
  - Before: `const presignedUrl = await this.s3.presignPut(key, fileType, 300);`
  - After:  `const presignedUrl = await this.stratus.presignPut(key, fileType, 300);`

- Line ~52 (`confirmUpload`):
  - Before: `let headResult: Awaited<ReturnType<typeof this.s3.head>>;`
  - After:  `let headResult: Awaited<ReturnType<typeof this.stratus.head>>;`

- Line ~54 (`confirmUpload`):
  - Before: `headResult = await this.s3.head(key);`
  - After:  `headResult = await this.stratus.head(key);`

- Line ~60 (`confirmUpload`, in the size-mismatch branch):
  - Before: `await this.s3.deleteOne(key);`
  - After:  `await this.stratus.deleteOne(key);`

- Line ~164 (`presignDownloadSingle`):
  - Before: `const url = await this.s3.presignGet(file.key, 300);`
  - After:  `const url = await this.stratus.presignGet(file.key, 300);`

A quick `grep -n "this\.s3" src/files/files.service.ts` after editing should return zero hits.

- [ ] **Step 4: Add the content-type equality check in `confirmUpload`**

Per the spec §"Preserving S3's content-type binding". Locate the existing size-mismatch block (around lines 59–62 of the pre-edit file):

```ts
    if (headResult.ContentLength !== fileSize) {
      await this.stratus.deleteOne(key);
      return { error: 'Upload appears incomplete — please try again', status: 400 } as const;
    }
```

Immediately **after** that closing brace, insert:

```ts
    if (headResult.ContentType !== fileType) {
      await this.stratus.deleteOne(key);
      return { error: 'Upload content type mismatch', status: 400 } as const;
    }
```

Order matters: size check first (matches today's behavior for clients sending nothing), content-type check second.

- [ ] **Step 5: Type-check**

Run: `yarn tsc --noEmit`
Expected: PASS for `files.service.ts`. (`download.controller.ts` and `folders.helpers.ts` may still fail because they haven't been swapped yet.) If only those two files' errors remain, proceed.

- [ ] **Step 6: Commit**

```bash
git add src/app.module.ts src/files/files.service.ts
git commit -m "refactor(files): swap S3Service for StratusService + add content-type parity check"
```

(This commit folds Task 6's `AppModule` swap with Task 7's first consumer swap, keeping each commit individually buildable as much as possible.)

---

## Task 8: Swap `S3Service` → `StratusService` in `download.controller.ts`

**Files:**
- Modify: `src/files/download.controller.ts`

- [ ] **Step 1: Update the import**

Find:
```ts
import { S3Service } from '../shared/s3/s3.service';
```
Replace with:
```ts
import { StratusService } from '../shared/stratus/stratus.service';
```

- [ ] **Step 2: Update the constructor field**

In the constructor (around line 30), find:
```ts
private readonly s3: S3Service,
```
Replace with:
```ts
private readonly stratus: StratusService,
```

- [ ] **Step 3: Update the two call sites**

There are exactly two `this.s3.presignGet(...)` calls (around lines 141 and 166). Replace both:

- Before: `const url = await this.s3.presignGet(file.key, 300);`
- After:  `const url = await this.stratus.presignGet(file.key, 300);`

A `grep -n "this\.s3" src/files/download.controller.ts` after editing should return zero hits.

- [ ] **Step 4: Type-check**

Run: `yarn tsc --noEmit`
Expected: only `folders.helpers.ts` errors should remain.

- [ ] **Step 5: Commit**

```bash
git add src/files/download.controller.ts
git commit -m "refactor(files): swap S3Service for StratusService in download.controller"
```

---

## Task 9: Swap `S3Service` → `StratusService` in `folders.helpers.ts` (+ update spec)

**Files:**
- Modify: `src/folders/folders.helpers.ts`
- Modify: `src/folders/folders.helpers.spec.ts`

- [ ] **Step 1: Update `folders.helpers.ts` import**

In `src/folders/folders.helpers.ts`, find:
```ts
import { S3Service } from '../shared/s3/s3.service';
```
Replace with:
```ts
import { StratusService } from '../shared/stratus/stratus.service';
```

- [ ] **Step 2: Update the constructor field**

Find:
```ts
private readonly s3: S3Service,
```
Replace with:
```ts
private readonly stratus: StratusService,
```

- [ ] **Step 3: Update the two `deleteMany` call sites**

There are two `this.s3.deleteMany(...)` calls (around lines 66 and 110):

- Before: `await this.s3.deleteMany(files.map((f) => f.key));`
- After:  `await this.stratus.deleteMany(files.map((f) => f.key));`

- Before: `await this.s3.deleteMany(expiredFiles.map((f) => f.key));`
- After:  `await this.stratus.deleteMany(expiredFiles.map((f) => f.key));`

A `grep -n "this\.s3" src/folders/folders.helpers.ts` after editing should return zero hits.

- [ ] **Step 4: Update `folders.helpers.spec.ts` import + provider**

In `src/folders/folders.helpers.spec.ts`, find:
```ts
import { S3Service } from '../shared/s3/s3.service';
```
Replace with:
```ts
import { StratusService } from '../shared/stratus/stratus.service';
```

Then in the `providers` array (around line 45), find:
```ts
{ provide: S3Service, useValue: { deleteMany: async () => undefined } },
```
Replace with:
```ts
{ provide: StratusService, useValue: { deleteMany: async () => undefined } },
```

The mock shape is unchanged because `FoldersHelpers` only uses `deleteMany` in its real code path.

- [ ] **Step 5: Type-check**

Run: `yarn tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 6: Lint**

Run: `yarn lint`
Expected: PASS, no errors.

- [ ] **Step 7: Run all specs**

Run: `yarn test`
Expected: PASS — `folders.helpers.spec.ts` should still pass with the new mock.

- [ ] **Step 8: Commit**

```bash
git add src/folders/folders.helpers.ts src/folders/folders.helpers.spec.ts
git commit -m "refactor(folders): swap S3Service for StratusService"
```

---

## Task 10: Sanity scan — no stray `S3Service` injections remain

**Files:**
- Read-only verification across `src/`.

- [ ] **Step 1: Confirm `S3Service` appears only in dormant S3 files**

Run:
```bash
grep -rn "S3Service" src/
```
Expected output (only S3's own files reference it):
```
src/shared/s3/s3.service.ts:<line>:export class S3Service {
src/shared/s3/s3.module.ts:<line>:import { S3Service } from './s3.service';
src/shared/s3/s3.module.ts:<line>:  providers: [S3Service],
src/shared/s3/s3.module.ts:<line>:  exports: [S3Service],
```

If any other file appears (especially in `src/files/`, `src/folders/`, or `src/app.module.ts`), go fix that file's import + injection before continuing.

- [ ] **Step 2: Confirm `S3Module` is no longer wired**

Run:
```bash
grep -rn "S3Module" src/
```
Expected output: only `src/shared/s3/s3.module.ts` itself (the export). If `src/app.module.ts` still appears, you missed Task 6 Step 2.

- [ ] **Step 3: Confirm `from '../shared/s3/'` is no longer used by live code**

Run:
```bash
grep -rn "from '\.\./shared/s3" src/
grep -rn "from '\.\./\.\./shared/s3" src/
```
Expected: zero results. If any consumer still imports from the s3 path, swap it to `stratus/`.

- [ ] **Step 4: No commit required.** This task is verification only.

---

## Task 11: Manual smoke verification

This task assumes a real Zoho Stratus bucket is reachable using the credentials in `.env`. Skip this task if you cannot run the dev server against real Stratus; document the skip in your handoff.

**Files:** none — runtime verification only.

- [ ] **Step 1: Start the dev server**

Run: `yarn start:dev`
Expected: server starts on port 3001 with no Stratus initialization errors. If you see `Invalid environment configuration`, re-check the `.env` file has all 7 `ZOHO_*` keys.

- [ ] **Step 2: Verify presigned PUT (happy path)**

Use Postman / `curl` (with a valid JWT) to call `POST /api/files/upload` with:
```json
{ "fileName": "smoke.txt", "fileType": "text/plain", "fileSize": 12 }
```

Expected response:
```json
{ "presignedUrl": "https://<stratus-endpoint>/...", "key": "uploads/<userId>/<uuid>.txt", "folderId": null }
```

The `presignedUrl` host should clearly be a Stratus / Zoho endpoint (not `s3.amazonaws.com`).

- [ ] **Step 3: Upload bytes**

Run:
```bash
echo -n 'hello stratus' > /tmp/smoke.txt
curl -X PUT --data-binary @/tmp/smoke.txt -H 'Content-Type: text/plain' '<presignedUrl>'
```
Expected: HTTP 200 from Stratus.

- [ ] **Step 4: Confirm the upload (happy path)**

Run `POST /api/files/confirm`:
```json
{ "key": "<key from step 2>", "fileName": "smoke.txt", "fileType": "text/plain", "fileSize": 13 }
```

Expected: HTTP 201, body `{ "file": { ... } }`. Verify the file row appears in Mongo (`db.files.findOne({ key: "<key>" })`).

- [ ] **Step 5: Size-mismatch path**

Repeat steps 2–3 with a fresh key. On confirm, lie about `fileSize` (e.g., `999`). Expected: HTTP 400 with body `{ "error": "Upload appears incomplete — please try again" }`. Verify the object is gone from Stratus (`HEAD` should 404).

- [ ] **Step 6: Content-type-mismatch path**

Repeat step 2 claiming `"fileType": "image/png"`. In step 3, send `Content-Type: text/html` on the PUT. Then call confirm with `"fileType": "image/png"`. Expected: HTTP 400 with body `{ "error": "Upload content type mismatch" }`. Verify the object is gone from Stratus.

- [ ] **Step 7: Download (single)**

Run `GET /api/files/download/<id>` with the file id from step 4. Expected: `{ "url": "https://<stratus-endpoint>/..." }`. Open the URL — the bytes should be `hello stratus`.

- [ ] **Step 8: Folder delete cascade**

Create a folder via `POST /api/folders`, upload a file into it (steps 2–4 with `folderId` set), then call `DELETE /api/folders/:id` to permanently delete (or `purgeExpiredTrash`, depending on your trash workflow). Expected: the file row is removed from Mongo and a Stratus `HEAD` on the key returns 404.

- [ ] **Step 9: Trash purge cron**

If you can trigger the cron manually (`POST /api/cron/purge-trash` with `CRON_SECRET`), confirm trashed files older than the retention window are deleted from Stratus. Otherwise: trash a file, manually backdate `deletedAt` in Mongo to before the cutoff, run the cron, verify object removal.

- [ ] **Step 10: No commit.** Manual verification produces no code change.

If any step fails, do **not** mark this task complete — file an issue and fix the underlying behavior. Common pitfalls:

- Step 2 returns an `s3.amazonaws.com` URL → `AppModule` still imports `S3Module`. Re-do Task 6.
- Step 4 returns 400 with "File not found in S3 — upload may have failed" → `getDetails()` is throwing for an existing object. Inspect the exception; the SDK may need a different code path (e.g. `headObject` first to check existence). If so, update `StratusService.head` to call `headObject` before `getDetails` and adapt the throw shape.
- Step 6 succeeds (returns 201) instead of failing 400 → either the content-type check wasn't added (re-do Task 7 Step 4) or Stratus did not persist the client's `Content-Type` header. Inspect via `bucket.object(key).getDetails()` directly — if the stored `content_type` matches what was claimed regardless of the PUT header, Stratus is canonicalizing the type and the security parity goal cannot be met as designed. Escalate to spec author.

---

## Task 12: Final review pass

**Files:** read-only.

- [ ] **Step 1: Inspect commit history**

Run: `git log --oneline master..HEAD`
Expected: a clean linear sequence of small, scoped commits.

- [ ] **Step 2: Inspect what changed**

Run: `git diff master --stat`
Expected files:
- New: `src/shared/stratus/stratus.module.ts`, `src/shared/stratus/stratus.service.ts`
- Modified: `src/app.module.ts`, `src/config/env.validation.ts`, `src/files/files.service.ts`, `src/files/download.controller.ts`, `src/folders/folders.helpers.ts`, `src/folders/folders.helpers.spec.ts`, `package.json`, `yarn.lock`
- **Not touched**: `src/shared/s3/*`, `.env`, anything under `src/auth/`, `src/common/`, `src/cron/`, `src/favourites/`, `src/health/`, `src/throttler/`, `src/trash/`, `src/files/contents.controller.ts`, `src/files/files.controller.ts`, `src/files/dto/*`.

If anything outside the expected set was touched, justify or revert.

- [ ] **Step 3: Run the full battery one more time**

Run all of:
```bash
yarn tsc --noEmit
yarn lint
yarn test
```
Expected: all PASS.

- [ ] **Step 4: Open the spec and verify each acceptance criterion is met**

Open `docs/superpowers/specs/2026-05-06-zoho-stratus-migration-design.md` and walk through each manual-verification item under §"Testing → Manual verification post-merge". You should have evidence (notes, log lines, screenshots) for items 1–8.

- [ ] **Step 5: No commit.** Plan complete.

---

## Notes for the executing engineer

- **Don't delete the S3 code.** The user explicitly wants `src/shared/s3/*` and the `@aws-sdk/*` deps to remain so a future revert is one `AppModule` line + a few field renames.
- **Don't change error strings.** The "File not found in S3 — upload may have failed" message is preserved verbatim per the spec's Non-goals.
- **The `_contentType` parameter on `presignPut` is intentional.** The spec calls it out: it exists for call-site parity with `S3Service` so consumers don't need to drop the argument.
- **If `getDetails()` proves expensive on the hot path** (it shouldn't — `confirmUpload` is once-per-upload, not per-request), the Task 11 Step 4 pitfall describes the fallback.
- **If the SDK API differs at install time** from what `zcatalyst-sdk-node@3.4.0` exposed (method renames, return shape changes, etc.), prefer adjusting the implementation over downgrading. Open a short follow-up to update this plan if the differences are non-trivial.
