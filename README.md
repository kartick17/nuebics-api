# NueVault API (NestJS)

NestJS port of the NueVault API originally built inside the Next.js app at `../nuebics-next-ts-app`. This service owns all backend endpoints for auth, file/folder storage, trash, favourites, and the purge cron. The frontend still lives in the Next.js project.

The port was executed with **byte-exact parity** for anything that interacts with persisted user data (MongoDB documents, bcrypt hashes, CryptoJS-AES-wrapped cookies, jose HS256 JWTs). Existing users can continue logging in against this service without any migration.

## Setup

```bash
yarn install
cp .env.example .env
# Fill .env with the same secrets as the Next.js deployment — see "Parity invariants" below
yarn start:dev       # watch mode, port from .env (default 3001)
yarn build           # compile to dist/
yarn start:prod      # run dist/main.js
yarn test            # jest unit tests
```

A successful boot logs:
```
[Nest] … MongooseCoreModule dependencies initialized
[Nest] … NestApplication  Nest application successfully started
[Bootstrap] API listening on :3001
```

## Architecture

- **Global prefix** `/api` — every route is mounted under `/api/...`.
- `cookie-parser` on the request pipeline; cookies are CryptoJS-AES-encrypted JWTs.
- `AllExceptionsFilter` translates thrown exceptions to `{ ok: false, error }` at the appropriate status.
- Feature modules: `AuthModule`, `FoldersModule`, `FilesModule`, `TrashModule`, `FavouritesModule`, `CronModule`.
- Shared global modules: `CryptoModule` (cookie/JWT crypto), `DatabaseModule` (Mongoose), `S3Module` (presign, head, delete), `ThrottlerModule` (login/signup/resend limits).
- Auth guard is `JwtAuthGuard` — reads `Authorization: Bearer <encrypted-token>`, decrypts (CryptoJS), verifies (jose), and attaches `req.user = { userId, sessionId }`.
- `@CurrentUser()` is a param decorator exposing `TokenPayload` in controllers.
- Resend-OTP is keyed by `userId:channel` via `UserChannelThrottlerGuard`.
- Cron is keyed by `x-cron-secret` header via `CronSecretGuard`.

## Endpoints

All require `Authorization: Bearer <cookie-access_token>` except where marked **Public**.

### Auth — `/api/auth`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/signup` | Public | Create user, generate OTPs (dispatch TODO). |
| POST | `/login` | Public | Sets 4 cookies: `access_token`, `refresh_token`, `user_details`, `encrypted_user_details`. |
| POST | `/logout` | Public | Clears all auth cookies. |
| POST | `/refresh` | Cookie | Uses `refresh_token` cookie; rotates refresh when < 1 day remains. |
| GET | `/me` | Bearer | Returns profile without `passwordHash`. |
| GET \| POST | `/verify-email` | Bearer | Status / verify with `{code}`. |
| GET \| POST | `/verify-phone` | Bearer | Status / verify with `{code}`. |
| POST | `/resend-otp` | Bearer | `{channel:"email"\|"phone"}`; throttled 3/15min per `userId:channel`. |
| GET \| POST | `/vault-password` | Bearer | Read/set the encrypted vault verifier blob. |

### Files & folders — `/api/files`

| Method | Path | Purpose |
|---|---|---|
| POST | `/upload` | Returns `{presignedUrl, key, folderId}` for direct-to-S3 PUT. |
| POST | `/confirm` | HEAD-checks S3 object + byte count, then creates the `File` doc. |
| GET | `/files?folderId=` | List active files in parent (or root). |
| PATCH | `/files/:id` | Rename and/or move. |
| DELETE | `/files/:id` | Soft-delete (status → trashed). |
| PATCH | `/files/:id/favourite` | Toggle favourite. |
| GET | `/folders?parentId=` | List active folders in parent. |
| POST | `/folders` | Create folder (unique name per parent). |
| GET | `/folders/:id` | Folder details + breadcrumbs. |
| PATCH | `/folders/:id` | Rename/move with cycle-detection. |
| DELETE | `/folders/:id` | Soft-delete recursively (S3 retained until purge). |
| PATCH | `/folders/:id/favourite` | Toggle favourite. |
| POST | `/download` | Batch: generates presigned GET URLs + folder-relative paths. Enforces `MAX_FILES`. |
| GET | `/download/:id` | Presigned GET URL for one file. |
| GET | `/contents?folderId=` | Atomic view: folders (with itemCount) + files + breadcrumbs. |
| GET | `/trash` | Root-level trashed items with childCount + retentionDays. |
| POST | `/trash/restore/:id?type=file\|folder` | Restore; folder restores recursively. |
| GET | `/favourites` | All favourited active files + folders. |
| PATCH | `/favourites/bulk` | `{fileIds?, folderIds?, isFavourite}`. |

### Cron — `/api/cron`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/purge-trash` | `x-cron-secret` header | Hard-deletes S3 + DB for items past retention. |

### Response shape asymmetry

Mirrored exactly from the Next.js source:
- Auth routes (login/signup/logout/refresh/me) use the `{ ok: true, ... }` / `{ ok: false, error }` envelope.
- File, folder, trash, favourites, verify-*, vault-password, cron routes return **bare** shapes (`{ folder }`, `{ files, folders }`, `{ success, message }`, `{ error }`, etc). Do not add the envelope to these — the frontend depends on the asymmetry.

## Parity invariants — DO NOT change

Anything breaking these will invalidate existing user data or sessions.

1. **Cookie encryption:** `CryptoJS.AES.encrypt(token, CRYPTO_SECRET).toString()` (CBC/PKCS7, OpenSSL-compatible KDF). Do NOT switch to `node:crypto` — ciphertext format differs.
2. **JWT signing:** `jose.SignJWT` with `HS256`, `setIssuedAt()`, `setExpirationTime('600s' | '432000s')`, key via `new TextEncoder().encode(JWT_*_SECRET)`.
3. **Password hashing:** `bcryptjs` with 12 rounds. Dummy hash used on login-miss for timing protection: `$2b$12$invalidhashfortimingprotection000000000000000000000000`.
4. **Token payload:** `{ userId, sessionId }` for access; refresh additionally has `exp`. `sessionId` is `crypto.randomUUID()` at login, never persisted to the DB.
5. **TTLs:** access 10 min, refresh 5 days; rotate refresh when `< 1 day` left.
6. **Cookie flags:** `access_token` is **not** httpOnly (frontend reads it for the Bearer header); `refresh_token` and `encrypted_user_details` are httpOnly. All are `sameSite:lax`, `secure` in prod, `path:/`. Cookie values are URL-encoded by Express — `cookie-parser` decodes on receipt.
7. **Mongoose collections:** `users`, `files`, `folders`. Field names + index definitions in `src/shared/database/schemas/` are copied verbatim from the source.
8. **S3 key format:** `uploads/${userId}/${uuidv4()}.${ext}`.
9. **Env var names** match the Next.js deployment exactly. `MAX_FILES` replaces the Next-only `NEXT_PUBLIC_MAX_FILES`.

Tests in `src/shared/crypto/crypto.service.spec.ts` assert round-trip parity with the Next.js source implementation (CryptoJS decrypt and jose verify).

## Environment variables

See `.env.example`. All are validated at startup via a Zod schema at `src/config/env.validation.ts`; the app refuses to boot on missing/invalid config.

```
MONGODB_URI               MongoDB connection string
JWT_ACCESS_SECRET         64-byte hex — MUST match Next.js deployment
JWT_REFRESH_SECRET        64-byte hex — MUST match Next.js deployment
CRYPTO_SECRET             64-byte hex — MUST match Next.js deployment
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_S3_BUCKET_NAME
MAX_FILES                 Download batch limit (default 50)
CRON_SECRET               Required in x-cron-secret header for purge-trash
PORT                      Default 3001
NODE_ENV                  development | production | test
CORS_ORIGIN               Optional, comma-separated; defaults to reflecting Origin with credentials
```

## Manual smoke test

A full curl walkthrough lives in `docs/superpowers/plans/2026-04-14-port-api-to-nestjs.md#task-25`. Minimal round-trip confirmed during the port:
- signup → login (sets 4 cookies) → `/me` with URL-decoded `access_token` as Bearer → create/list folder → presign S3 PUT → refresh → logout.

When extracting the cookie value from a curl jar to use as Bearer, URL-decode first (Express stores the percent-encoded form); browsers handle this automatically.

## Known limitations

- **OTP dispatch is not wired.** Both the source and this port store the 6-digit OTP in the user document but never send it via email/SMS. A follow-up should plug in SES/SNS/Twilio.
- **Rate-limiting is per-process.** `@nestjs/throttler` uses an in-memory store. Deploying more than one replica requires swapping the storage adapter (Redis).
- **Session revocation is cookie-clear only.** There is no server-side session table; logging out a compromised device requires rotating `JWT_*_SECRET` or waiting for natural expiry.
- **Stateless sessionId.** The `sessionId` in JWT claims is never persisted, so server-side "active sessions" listings are not possible without adding a model.

## Project layout

```
src/
├── main.ts                          # bootstrap, cookie-parser, /api prefix, CORS, filter
├── app.module.ts                    # composes every feature module
├── config/                          # env validation
├── common/
│   ├── filters/                     # AllExceptionsFilter
│   ├── guards/                      # JwtAuthGuard, CronSecretGuard, UserChannelThrottlerGuard
│   ├── decorators/                  # @CurrentUser
│   ├── pipes/                       # ZodValidationPipe
│   └── response/                    # ok/err/validationErr helpers
├── shared/
│   ├── crypto/                      # CryptoService + parity tests
│   ├── database/                    # Mongoose schemas + DatabaseModule
│   └── s3/                          # S3Service
├── auth/                            # auth, verification, vault-password + CookieService
├── folders/                         # CRUD + helpers + DTOs (cycle detection tested)
├── files/                           # CRUD + download (batch+single) + contents
├── trash/                           # trash list + restore
├── favourites/                      # list + bulk toggle
├── cron/                            # purge-trash
└── throttler/                       # ThrottlerModule config
```

## License

UNLICENSED — internal.
