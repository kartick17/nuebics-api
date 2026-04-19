# NueVault API (NestJS)

NestJS port of the NueVault API originally built inside the Next.js app at `../nuebics-next-ts-app`. This service owns all backend endpoints for auth, file/folder storage, trash, favourites, and the purge cron. The frontend still lives in the Next.js project.

The auth flow is **stateless JWT-in-body**. Login and refresh return plain `access_token` / `refresh_token` JWTs in the JSON response. The backend does not set cookies, does not encrypt tokens, and does not read cookies on protected routes — the `Authorization: Bearer <jwt>` header is the only accepted credential. Cookie storage and any at-rest token encryption are the BFF's responsibility. Mobile clients can use secure storage. Persisted user data (Mongo documents, bcrypt hashes, the AES-encrypted vault credential) remains byte-exact with the Next.js source.

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
- `AllExceptionsFilter` translates thrown exceptions to `{ ok: false, error }` at the appropriate status.
- Feature modules: `AuthModule`, `FoldersModule`, `FilesModule`, `TrashModule`, `FavouritesModule`, `CronModule`.
- Shared global modules: `CryptoModule` (JWT signing + AES for the vault credential), `DatabaseModule` (Mongoose), `S3Module` (presign, head, delete), `ThrottlerModule` (login/signup/resend limits).
- Auth guard is `JwtAuthGuard` — reads `Authorization: Bearer <jwt>`, verifies with `jose`, and attaches `req.user = { userId, sessionId }`. No cookie reads anywhere.
- `@CurrentUser()` is a param decorator exposing `TokenPayload` in controllers.
- Resend-OTP is keyed by `userId:channel` via `UserChannelThrottlerGuard`.
- Cron is keyed by `x-cron-secret` header via `CronSecretGuard`.

## Endpoints

All protected routes require `Authorization: Bearer <access_token>` except where marked **Public**.

### Auth — `/api/auth`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/signup` | Public | Create user, generate OTPs (dispatch TODO). |
| POST | `/login` | Public | Returns `{ ok, message, user_details, access_token, refresh_token }` in body. |
| POST | `/refresh` | Body | Takes `{ refresh_token }`; always rotates and returns new `access_token` + `refresh_token` in body. |
| GET | `/me` | Bearer | Returns `{ ok, user_details }`. |
| GET \| POST | `/verify-email` | Bearer | Status / verify with `{code}`; POST returns `{ ok, message, user_details }`. |
| GET \| POST | `/verify-phone` | Bearer | Status / verify with `{code}`; POST returns `{ ok, message, user_details }`. |
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

### Response shape

- Auth, verification, and vault-password routes use `{ ok: true, ... }` for success and `{ ok: false, error }` for errors.
- File, folder, trash, favourites, and cron routes return bare shapes (`{ folder }`, `{ files, folders }`, `{ success, message }`, `{ error }`, etc). Do not add the envelope to these — the frontend depends on the asymmetry.

## Invariants — DO NOT change

Anything breaking these will invalidate existing user data.

1. **JWT signing:** `jose.SignJWT` with `HS256`, `setIssuedAt()`, `setExpirationTime('600s' | '432000s')`, key via `new TextEncoder().encode(JWT_*_SECRET)`. Tokens are returned in the response body — no encryption wrapping.
2. **Password hashing:** `bcryptjs` with 12 rounds. Dummy hash used on login-miss for timing protection: `$2b$12$invalidhashfortimingprotection000000000000000000000000`.
3. **Token payload:** `{ userId, sessionId }` for access; refresh additionally has `exp`. `sessionId` is `crypto.randomUUID()` at login, never persisted to the DB.
4. **TTLs:** access 10 min, refresh 5 days. Every refresh call rotates both tokens.
5. **Vault credential encryption:** `vaultCredentialVerifier` in the `users` collection is still AES-encrypted at rest via `CryptoService.encryptToken` (CryptoJS, OpenSSL-compatible KDF, `CRYPTO_SECRET`). This is independent of JWT transport.
6. **Mongoose collections:** `users`, `files`, `folders`. Field names + index definitions in `src/shared/database/schemas/` are copied verbatim from the source.
7. **S3 key format:** `uploads/${userId}/${uuidv4()}.${ext}`.
8. **Env var names** match the Next.js deployment exactly. `MAX_FILES` replaces the Next-only `NEXT_PUBLIC_MAX_FILES`.

## Environment variables

See `.env.example`. All are validated at startup via a Zod schema at `src/config/env.validation.ts`; the app refuses to boot on missing/invalid config.

```
MONGODB_URI               MongoDB connection string
JWT_ACCESS_SECRET         64-byte hex
JWT_REFRESH_SECRET        64-byte hex
CRYPTO_SECRET             64-byte hex (AES key for vaultCredentialVerifier at rest)
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_S3_BUCKET_NAME
MAX_FILES                 Download batch limit (default 50)
CRON_SECRET               Required in x-cron-secret header for purge-trash
PORT                      Default 3001
NODE_ENV                  development | production | test
CORS_ORIGIN               Optional, comma-separated
```

## Manual smoke test

```bash
# signup
curl -s -X POST localhost:3001/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"name":"A","email":"a@b.com","phone":"+15550001111","password":"Password123!","confirmPassword":"Password123!"}'

# login — tokens returned in JSON body
curl -s -X POST localhost:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"a@b.com","password":"Password123!"}' | jq

# me with bearer
curl -s localhost:3001/api/auth/me -H "Authorization: Bearer $ACCESS" | jq

# refresh — sends refresh_token in body, gets new pair
curl -s -X POST localhost:3001/api/auth/refresh \
  -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}" | jq
```

No cookies are set on any response. The BFF (or mobile client) owns token storage.

## Known limitations

- **OTP dispatch is not wired.** Both the source and this port store the 6-digit OTP in the user document but never send it via email/SMS. A follow-up should plug in SES/SNS/Twilio.
- **Rate-limiting is per-process.** `@nestjs/throttler` uses an in-memory store. Deploying more than one replica requires swapping the storage adapter (Redis).
- **No server-side revocation.** Access tokens are stateless; a leaked token is valid until its 10-minute expiry. Shorter TTLs and/or a Redis-backed blacklist can be added if needed.
- **Stateless sessionId.** The `sessionId` in JWT claims is never persisted, so server-side "active sessions" listings are not possible without adding a model.

## Project layout

```
src/
├── main.ts                          # bootstrap, /api prefix, CORS, filter
├── app.module.ts                    # composes every feature module
├── config/                          # env validation
├── common/
│   ├── filters/                     # AllExceptionsFilter
│   ├── guards/                      # JwtAuthGuard, CronSecretGuard, UserChannelThrottlerGuard
│   ├── decorators/                  # @CurrentUser
│   ├── pipes/                       # ZodValidationPipe
│   └── response/                    # ok/err/validationErr helpers
├── shared/
│   ├── crypto/                      # CryptoService (JWT sign/verify + AES for vault credential)
│   ├── database/                    # Mongoose schemas + DatabaseModule
│   └── s3/                          # S3Service
├── auth/                            # auth, verification, vault-password + user-details serializer
├── folders/                         # CRUD + helpers + DTOs (cycle detection tested)
├── files/                           # CRUD + download (batch+single) + contents
├── trash/                           # trash list + restore
├── favourites/                      # list + bulk toggle
├── cron/                            # purge-trash
└── throttler/                       # ThrottlerModule config
```

## License

UNLICENSED — internal.
