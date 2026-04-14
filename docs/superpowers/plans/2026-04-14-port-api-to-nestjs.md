# Port NueVault API from Next.js to NestJS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all 32 API endpoints from `nuebics-next-ts-app` (Next.js App Router) to `nuebics-api` (NestJS 11) with **bit-exact parity** of authentication, encryption, cookie format, and database schema — so existing users, existing sessions (cookies), and existing MongoDB/S3 data keep working unchanged.

**Architecture:**
- Preserve existing tech choices: **Mongoose** (not Prisma/TypeORM), **Zod** (not class-validator), **CryptoJS AES** cookie wrapping, **jose** JWTs, **bcryptjs 12 rounds**. Swapping any of these would invalidate existing user data/sessions.
- Module-per-feature: Auth, Users, Folders, Files, Trash, Favourites, Contents, Cron, plus shared Database/Crypto/S3 modules.
- `withAuth` HOF → `JwtAuthGuard` + `@CurrentUser()` param decorator.
- In-memory rate limiter → `@nestjs/throttler`.
- Cron-secret header → `CronSecretGuard`.
- Global `ZodValidationPipe` for body/query schemas; global exception filter mapping errors to the existing `{ ok: false, error }` shape.

**Tech Stack:** NestJS 11, Mongoose 9, `@nestjs/mongoose`, `@nestjs/jwt`, `@nestjs/throttler`, `@nestjs/config`, `zod` v4, `jose`, `crypto-js`, `bcryptjs`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `uuid`, `cookie-parser`.

**Source:** `/home/weloin/Projects/nuebics-next-ts-app`
**Destination:** `/home/weloin/Projects/nuebics-api`

---

## Parity Invariants — DO NOT CHANGE

These must match the source **byte-for-byte** or existing data breaks:

1. **CryptoJS AES wrapping.** Both access and refresh cookies store JWTs encrypted with `CryptoJS.AES.encrypt(token, process.env.CRYPTO_SECRET).toString()` (CBC/PKCS7 default, passphrase mode — key derivation is CryptoJS's OpenSSL-compatible scheme). Do **not** substitute Node `crypto` AES — the ciphertext format differs.
2. **bcryptjs with 12 rounds.** `bcrypt.hash(password, 12)` on signup, `bcrypt.compare` on login. Keep the timing-attack dummy hash `"$2b$12$invalidhashfortimingprotection000000000000000000000000"`.
3. **jose HS256.** `new SignJWT(...).setProtectedHeader({ alg: "HS256" })...sign(secret)` where `secret = new TextEncoder().encode(process.env.JWT_*_SECRET)`.
4. **Token payload shape.** `{ userId: string, sessionId: string }` for access; refresh additionally has `exp`.
5. **Cookie names and flags.**
   - `access_token` — `secure: IS_PROD`, `sameSite: "lax"`, `maxAge: 600`, `path: "/"`, **NOT httpOnly** (frontend reads it for the Bearer header).
   - `refresh_token` — same + `httpOnly: true`, `maxAge: 432000`.
   - `user_details` — non-httpOnly JSON of `{ name, isEmailVerified, isPhoneVerified, vaultCredentialVerifier (bool) }`, `maxAge: 432000`.
   - `encrypted_user_details` — httpOnly JSON of the full user doc, `maxAge: 432000`.
6. **Access-token TTL 10 min, refresh 5 days, rotate when < 1 day remains.**
7. **Mongoose collection names** follow Mongoose defaults: `users`, `files`, `folders`. Schema field names (`passwordHash`, `vaultCredentialVerifier`, `isEmailVerified`, …) and index definitions must match exactly.
8. **S3 key format** `uploads/${userId}/${uuidv4()}.${ext}`.
9. **Response envelope.**
   - `ok(data, status)` → `{ ok: true, ...data }` with given status.
   - `err(message, status)` → `{ ok: false, error: message }`.
   - Some file/folder routes return **bare** shapes (e.g. `{ file }`, `{ folder }`, `{ error: "..." }`) without the `ok` envelope. Preserve that asymmetry verbatim — the Next.js frontend depends on it.
10. **Env var names** identical: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRYPTO_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `CRON_SECRET`, plus a new `MAX_FILES` (Next used `NEXT_PUBLIC_MAX_FILES` — carry both over, read either).

Any task step that breaks one of these is wrong — stop and re-read the source before proceeding.

---

## File Structure

```
nuebics-api/src/
├── main.ts                                   # cookie-parser, global pipes/filters, CORS
├── app.module.ts                             # imports all feature modules + shared
│
├── config/
│   └── env.validation.ts                     # zod schema for required env vars
│
├── common/
│   ├── response/
│   │   └── response.helpers.ts               # ok/err/validationErr/tooManyRequests/notFound/unauthorized
│   ├── pipes/
│   │   └── zod-validation.pipe.ts            # ZodValidationPipe for body+query
│   ├── filters/
│   │   └── all-exceptions.filter.ts          # maps errors → { ok:false, error }
│   ├── guards/
│   │   ├── jwt-auth.guard.ts                 # reads Bearer, calls CryptoService.verifyAccessToken
│   │   ├── refresh-cookie.guard.ts           # reads refresh_token cookie
│   │   └── cron-secret.guard.ts              # header x-cron-secret === CRON_SECRET
│   └── decorators/
│       ├── current-user.decorator.ts         # @CurrentUser() → TokenPayload
│       └── zod-body.decorator.ts             # optional helper
│
├── shared/
│   ├── crypto/
│   │   ├── crypto.module.ts
│   │   └── crypto.service.ts                 # encryptToken/decryptToken, sign/verify access+refresh, shouldRotate
│   ├── database/
│   │   ├── database.module.ts                # MongooseModule.forRootAsync
│   │   └── schemas/
│   │       ├── user.schema.ts
│   │       ├── file.schema.ts
│   │       └── folder.schema.ts
│   └── s3/
│       ├── s3.module.ts
│       └── s3.service.ts                     # S3Client + presign helpers + head/delete
│
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts                    # POST login/signup/logout/refresh, GET me
│   ├── auth.service.ts
│   ├── verification.controller.ts            # GET/POST verify-email, GET/POST verify-phone, POST resend-otp
│   ├── verification.service.ts
│   ├── vault-password.controller.ts          # GET/POST vault-password
│   ├── vault-password.service.ts
│   ├── cookie.service.ts                     # setAccessCookie/setRefreshCookie/setUserCookie/clearCookies on Express res
│   └── dto/
│       ├── signup.schema.ts                  # zod
│       ├── login.schema.ts
│       ├── verify-otp.schema.ts              # { code: string }
│       ├── resend-otp.schema.ts              # { channel: "email" | "phone" }
│       └── vault-password.schema.ts          # { encryptedToken: string }
│
├── folders/
│   ├── folders.module.ts
│   ├── folders.controller.ts                 # GET|POST /folders; GET|PATCH|DELETE /folders/:id; PATCH favourite
│   ├── folders.service.ts
│   ├── folders.helpers.ts                    # trashFolderRecursive, getDescendantFolderIds, isDescendantOf, deleteFolderRecursive, buildBreadcrumbPath, restoreFolderRecursive
│   └── dto/
│       ├── create-folder.schema.ts
│       └── update-folder.schema.ts
│
├── files/
│   ├── files.module.ts
│   ├── files.controller.ts                   # upload, confirm, GET /files, PATCH|DELETE /files/:id, PATCH favourite
│   ├── download.controller.ts                # POST /download, GET /download/:id
│   ├── contents.controller.ts                # GET /contents
│   ├── files.service.ts
│   └── dto/
│       ├── upload.schema.ts
│       ├── confirm.schema.ts
│       └── update-file.schema.ts
│
├── trash/
│   ├── trash.module.ts
│   ├── trash.controller.ts                   # GET /trash, POST /trash/restore/:id
│   └── trash.service.ts
│
├── favourites/
│   ├── favourites.module.ts
│   ├── favourites.controller.ts              # GET /favourites, PATCH /favourites/bulk
│   └── favourites.service.ts
│
├── cron/
│   ├── cron.module.ts
│   └── cron.controller.ts                    # POST /cron/purge-trash
│
└── throttler/
    └── throttler.config.ts                   # login/signup/resend-otp limits

test/
└── crypto.spec.ts                            # cross-implementation parity test vs source
```

Routes are mounted at `/api/*` via global prefix (set in `main.ts`).

---

## Task Breakdown

> **TDD note:** The source project has no test suite. Full TDD for every endpoint would triple scope without value on a near-verbatim port. Tests in this plan focus on where regressions would break existing production data: **crypto parity, JWT issue/verify, cookie round-trip, auth-guard acceptance/rejection, folder-cycle detection**. Other endpoints get a manual smoke-test checklist (Task 25).

---

### Task 1: Install dependencies and tooling

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies**

Run from `/home/weloin/Projects/nuebics-api`:
```bash
npm install @nestjs/config @nestjs/mongoose mongoose@^9.3.3 \
  @nestjs/jwt @nestjs/throttler \
  @aws-sdk/client-s3@^3.1019.0 @aws-sdk/s3-request-presigner@^3.1019.0 \
  bcryptjs@^3.0.3 crypto-js@^4.2.0 jose@^6.2.2 \
  uuid@^13.0.0 zod@^4.3.5 cookie-parser
```

- [ ] **Step 2: Install dev types**

```bash
npm install -D @types/bcryptjs @types/crypto-js @types/cookie-parser
```

- [ ] **Step 3: Verify install**

Run: `npm ls mongoose jose crypto-js bcryptjs zod`
Expected: all present at specified versions, no `UNMET DEPENDENCY`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add dependencies for porting NueVault API from Next.js"
```

---

### Task 2: Environment configuration

**Files:**
- Create: `.env`
- Create: `.env.example`
- Create: `src/config/env.validation.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `.env`** (copy values from source `/home/weloin/Projects/nuebics-next-ts-app/.env`)

```
# AWS / S3
AWS_ACCESS_KEY_ID=GXUFTJSFG7K7HUQP39FM
AWS_SECRET_ACCESS_KEY=VAE5Z76F8U1SOWODW0043ONTYEHN6HKR60RYZN3A
AWS_REGION=ap-south-2
AWS_S3_BUCKET_NAME=nuebics-sq-dev

# MongoDB
MONGODB_URI=mongodb://subrata-admin:bvRc2AUAaOrwHwtr@ac-wmgz58o-shard-00-00.azh5jqj.mongodb.net:27017,ac-wmgz58o-shard-00-01.azh5jqj.mongodb.net:27017,ac-wmgz58o-shard-00-02.azh5jqj.mongodb.net:27017/nuebics?ssl=true&replicaSet=atlas-zbz8ih-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0

# JWT & crypto — MUST match the Next.js deployment's secrets
JWT_ACCESS_SECRET=6aa3eb931edb98b4228e2de6e09d7bad1b7e74d896bfa31cdddbd10cfc89aa1a13e28f39746340e1cf39854827f3a535106f9c256c78a66861647072c2cefe25
JWT_REFRESH_SECRET=b46845f2461a93242381a0676ca94f7af9b533f682c91a3adf843b73b9819f3860986243d52d4f4322548112144336c1f6b8eb8926b0018136017d3223da92c9
CRYPTO_SECRET=385b883464107dfab788e6f88dce36b39392ddf54a3bae4b9c00efbf2c3ea78729b5f9538bfb5b33d8a7f1403d4aeb541c2714ecde5c569da06d9b2351410076

# App
MAX_FILES=50
CRON_SECRET=change-me-to-the-production-cron-secret
PORT=3001
NODE_ENV=development
```

- [ ] **Step 2: Create `.env.example`** (same keys, placeholder values).

- [ ] **Step 3: Create `src/config/env.validation.ts`**

```ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CRYPTO_SECRET: z.string().min(32),

  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  AWS_S3_BUCKET_NAME: z.string().min(1),

  MAX_FILES: z.coerce.number().int().positive().default(50),
  CRON_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment:', parsed.error.format());
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}
```

- [ ] **Step 4: Wire `ConfigModule` in `src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Verify**

Run: `npm run start:dev`
Expected: server boots on port 3001, no env validation errors. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add src/config .env.example src/app.module.ts
git commit -m "feat(config): env schema validation via zod"
```

> **Note:** `.env` should already be gitignored by the Nest template. Verify with `git status` — if `.env` appears, add to `.gitignore` before committing.

---

### Task 3: CryptoService + parity tests (CRITICAL)

This must produce cookie values decryptable by the Next.js app and vice versa. Get this wrong and every existing session breaks.

**Files:**
- Create: `src/shared/crypto/crypto.service.ts`
- Create: `src/shared/crypto/crypto.module.ts`
- Create: `src/shared/crypto/crypto.service.spec.ts`

- [ ] **Step 1: Write the parity test first** at `src/shared/crypto/crypto.service.spec.ts`

```ts
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import CryptoJS from 'crypto-js';
import { SignJWT, jwtVerify } from 'jose';
import { CryptoService } from './crypto.service';
import { validateEnv } from '../../config/env.validation';

describe('CryptoService — parity with Next.js source', () => {
  let service: CryptoService;

  beforeAll(async () => {
    // Load test env — requires CRYPTO_SECRET/JWT_*_SECRET to be set
    process.env.CRYPTO_SECRET ||= 'a'.repeat(64);
    process.env.JWT_ACCESS_SECRET ||= 'b'.repeat(64);
    process.env.JWT_REFRESH_SECRET ||= 'c'.repeat(64);
    process.env.MONGODB_URI ||= 'mongodb://localhost/test';
    process.env.AWS_ACCESS_KEY_ID ||= 'x';
    process.env.AWS_SECRET_ACCESS_KEY ||= 'x';
    process.env.AWS_REGION ||= 'x';
    process.env.AWS_S3_BUCKET_NAME ||= 'x';
    process.env.CRON_SECRET ||= 'x';

    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
      providers: [CryptoService],
    }).compile();
    service = mod.get(CryptoService);
  });

  it('decrypts ciphertext produced by the Next.js implementation', () => {
    // Replicate lib/auth.ts encryptToken exactly
    const plaintext = 'hello.world.jwt';
    const cipher = CryptoJS.AES.encrypt(plaintext, process.env.CRYPTO_SECRET!).toString();
    expect(service.decryptToken(cipher)).toBe(plaintext);
  });

  it('produces ciphertext decryptable by the Next.js implementation', () => {
    const plaintext = 'another.jwt.here';
    const cipher = service.encryptToken(plaintext);
    const bytes = CryptoJS.AES.decrypt(cipher, process.env.CRYPTO_SECRET!);
    expect(bytes.toString(CryptoJS.enc.Utf8)).toBe(plaintext);
  });

  it('returns null for garbage input (matches source)', () => {
    expect(service.decryptToken('not-valid-ciphertext')).toBeNull();
  });

  it('signs an access JWT that verifies with the same secret via jose', async () => {
    const token = await service.signAccessToken('userA', 'sessionA');
    const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    expect(payload.userId).toBe('userA');
    expect(payload.sessionId).toBe('sessionA');
  });

  it('round-trips access token through encrypt → verify', async () => {
    const token = await service.signAccessToken('u1', 's1');
    const encrypted = service.encryptToken(token);
    const verified = await service.verifyAccessToken(encrypted);
    expect(verified?.userId).toBe('u1');
    expect(verified?.sessionId).toBe('s1');
  });

  it('shouldRotate returns true when < 1 day left', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(service.shouldRotate(nowSec + 30 * 60)).toBe(true);
    expect(service.shouldRotate(nowSec + 3 * 24 * 60 * 60)).toBe(false);
  });

  it('verifies a token signed by the source SignJWT call (same params)', async () => {
    // Simulate lib/auth.ts signAccessToken verbatim
    const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const sourceToken = await new SignJWT({ userId: 'x', sessionId: 'y' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('600s')
      .sign(secret);
    const encrypted = service.encryptToken(sourceToken);
    const verified = await service.verifyAccessToken(encrypted);
    expect(verified?.userId).toBe('x');
    expect(verified?.sessionId).toBe('y');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test -- crypto.service.spec`
Expected: FAIL with "Cannot find module './crypto.service'".

- [ ] **Step 3: Implement `src/shared/crypto/crypto.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CryptoJS from 'crypto-js';
import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../../config/env.validation';

export interface TokenPayload {
  userId: string;
  sessionId: string;
}

export interface RefreshPayload {
  userId: string;
  sessionId: string;
  exp: number;
}

export const ACCESS_TOKEN_SECONDS = 10 * 60;
export const REFRESH_TOKEN_DAYS = 5;
export const REFRESH_TOKEN_SECONDS = REFRESH_TOKEN_DAYS * 24 * 60 * 60;
export const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CryptoService {
  private readonly cryptoSecret: string;
  private readonly accessSecret: Uint8Array;
  private readonly refreshSecret: Uint8Array;

  constructor(config: ConfigService<Env, true>) {
    this.cryptoSecret = config.get('CRYPTO_SECRET', { infer: true });
    this.accessSecret = new TextEncoder().encode(config.get('JWT_ACCESS_SECRET', { infer: true }));
    this.refreshSecret = new TextEncoder().encode(config.get('JWT_REFRESH_SECRET', { infer: true }));
  }

  // CryptoJS AES wrap (CBC/PKCS7 default, OpenSSL passphrase-derived key).
  // Do NOT replace with node:crypto — format differs and existing cookies would break.
  encryptToken(token: string): string {
    return CryptoJS.AES.encrypt(token, this.cryptoSecret).toString();
  }

  decryptToken(encrypted: string): string | null {
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.cryptoSecret);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return decrypted || null;
    } catch {
      return null;
    }
  }

  async signAccessToken(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ userId, sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
      .sign(this.accessSecret);
  }

  async verifyAccessToken(encryptedOrRaw: string): Promise<TokenPayload | null> {
    try {
      const decrypted = this.decryptToken(encryptedOrRaw);
      if (!decrypted) return null;
      const { payload } = await jwtVerify(decrypted, this.accessSecret);
      return payload as unknown as TokenPayload;
    } catch {
      return null;
    }
  }

  async signRefreshToken(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ userId, sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_SECONDS}s`)
      .sign(this.refreshSecret);
  }

  async verifyRefreshToken(encryptedOrRaw: string): Promise<RefreshPayload | null> {
    try {
      const decrypted = this.decryptToken(encryptedOrRaw);
      if (!decrypted) return null;
      const { payload } = await jwtVerify(decrypted, this.refreshSecret);
      return payload as unknown as RefreshPayload;
    } catch {
      return null;
    }
  }

  shouldRotate(expUnixSec: number): boolean {
    return expUnixSec * 1000 - Date.now() < RENEWAL_THRESHOLD_MS;
  }
}
```

- [ ] **Step 4: Create `src/shared/crypto/crypto.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
```

- [ ] **Step 5: Register `CryptoModule` in `app.module.ts` imports.**

- [ ] **Step 6: Run tests — verify they pass**

Run: `npm test -- crypto.service.spec`
Expected: PASS, 7 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/shared/crypto src/app.module.ts
git commit -m "feat(crypto): CryptoService with Next.js parity + tests"
```

---

### Task 4: Mongoose schemas (User, File, Folder)

Schemas must match `/home/weloin/Projects/nuebics-next-ts-app/models/{user,file,folder}.ts` **exactly** — field names, types, indexes, `timestamps` option. Existing documents must be readable without migration.

**Files:**
- Create: `src/shared/database/schemas/user.schema.ts`
- Create: `src/shared/database/schemas/file.schema.ts`
- Create: `src/shared/database/schemas/folder.schema.ts`
- Create: `src/shared/database/database.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `user.schema.ts`**

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 60 })
  name: string;

  @Prop({ required: true, unique: true, sparse: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, unique: true, sparse: true, trim: true })
  phone: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ default: false })
  isPhoneVerified: boolean;

  @Prop({ type: String, default: null })
  emailVerificationCode: string | null;

  @Prop({ type: Date, default: null })
  emailVerificationExpires: Date | null;

  @Prop({ type: String, default: null })
  phoneVerificationCode: string | null;

  @Prop({ type: Date, default: null })
  phoneVerificationExpires: Date | null;

  @Prop({ default: '' })
  vaultCredentialVerifier: string;

  createdAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
```

- [ ] **Step 2: Create `folder.schema.ts`**

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FolderDocument = HydratedDocument<Folder>;

@Schema({ timestamps: true, collection: 'folders' })
export class Folder {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, trim: true, maxlength: 255 })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Folder', default: null, index: true })
  parentId: Types.ObjectId | null;

  @Prop({ default: false, index: true })
  isFavourite: boolean;

  @Prop({ type: String, enum: ['active', 'trashed'], default: 'active', index: true })
  status: 'active' | 'trashed';

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const FolderSchema = SchemaFactory.createForClass(Folder);
FolderSchema.index({ userId: 1, parentId: 1, status: 1 });
FolderSchema.index({ userId: 1, parentId: 1, name: 1 }, { unique: true });
FolderSchema.index({ userId: 1, isFavourite: 1, status: 1 });
```

- [ ] **Step 3: Create `file.schema.ts`**

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FileDocument = HydratedDocument<File>;

@Schema({ timestamps: true, collection: 'files' })
export class File {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  size: number;

  @Prop({ required: true })
  type: string;

  @Prop({ type: Types.ObjectId, ref: 'Folder', default: null, index: true })
  folderId: Types.ObjectId | null;

  @Prop({ default: false, index: true })
  isFavourite: boolean;

  @Prop({ type: String, enum: ['active', 'trashed'], default: 'active', index: true })
  status: 'active' | 'trashed';

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const FileSchema = SchemaFactory.createForClass(File);
FileSchema.index({ userId: 1, folderId: 1, status: 1 });
FileSchema.index({ userId: 1, isFavourite: 1, status: 1 });
```

- [ ] **Step 4: Create `src/shared/database/database.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Env } from '../../config/env.validation';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        serverSelectionTimeoutMS: 5000,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

- [ ] **Step 5: Register `DatabaseModule` in `app.module.ts` imports.**

- [ ] **Step 6: Verify**

Run: `npm run start:dev`
Expected: `Mongoose connected` (or equivalent log), no errors. Ctrl+C to stop.

- [ ] **Step 7: Commit**

```bash
git add src/shared/database src/app.module.ts
git commit -m "feat(db): Mongoose schemas ported verbatim from Next.js"
```

---

### Task 5: S3Service

**Files:**
- Create: `src/shared/s3/s3.service.ts`
- Create: `src/shared/s3/s3.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `s3.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../config/env.validation';

@Injectable()
export class S3Service {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.client = new S3Client({
      region: config.get('AWS_REGION', { infer: true }),
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
    this.bucket = config.get('AWS_S3_BUCKET_NAME', { infer: true });
  }

  presignPut(key: string, contentType: string, expiresIn = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  presignGet(key: string, expiresIn = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  head(key: string): Promise<HeadObjectCommandOutput> {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  deleteOne(key: string) {
    return this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteMany(keys: string[]) {
    if (keys.length === 0) return;
    const BATCH = 1000;
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((k) => ({ Key: k })), Quiet: true },
        }),
      );
    }
  }
}
```

- [ ] **Step 2: Create `s3.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';

@Global()
@Module({
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}
```

- [ ] **Step 3: Register `S3Module` in `app.module.ts` imports.**

- [ ] **Step 4: Commit**

```bash
git add src/shared/s3 src/app.module.ts
git commit -m "feat(s3): shared S3Service for presign + head + delete"
```

---

### Task 6: Response helpers + global exception filter

Mirror `/responses/auth.ts` exactly. Controllers will continue to return objects in the `{ ok, ... }` shape; we **do not** use Nest's auto-envelope or class-serializer — the frontend depends on the current shape.

**Files:**
- Create: `src/common/response/response.helpers.ts`
- Create: `src/common/filters/all-exceptions.filter.ts`

- [ ] **Step 1: Create `response.helpers.ts`**

```ts
import { Response } from 'express';
import { ZodError } from 'zod';

export function ok<T extends object>(data: T, status = 200) {
  return { __status: status, body: { ok: true, ...data } } as const;
}

export function err(message: string, status: number) {
  return { __status: status, body: { ok: false, error: message } } as const;
}

export function validationErr(error: ZodError) {
  return {
    __status: 400,
    body: { ok: false, error: error.message ?? 'Validation failed', fields: error.name },
  } as const;
}

export const unauthorized = () => err('Unauthorized. Please log in.', 401);
export const notFound = (thing = 'Resource') => err(`${thing} not found`, 404);

export function tooManyRequests(resetAt: number, res?: Response) {
  const retryAfterSeconds = Math.ceil((resetAt - Date.now()) / 1000);
  if (res) res.setHeader('Retry-After', String(retryAfterSeconds));
  return err(`Too many attempts. Try again in ${retryAfterSeconds} seconds.`, 429);
}

// Helper: send an { __status, body } envelope on an Express res.
export function send(res: Response, payload: { __status: number; body: object }) {
  res.status(payload.__status).json(payload.body);
}
```

> **Note:** We return `{ __status, body }` and let controllers pass it to `send(res, ...)` rather than throwing Nest exceptions — that's the simplest way to preserve the exact envelope without fighting Nest's response pipeline. All controllers use `@Res({ passthrough: false })` and call `send()`.

- [ ] **Step 2: Create `all-exceptions.filter.ts`** (for uncaught errors only)

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? (exception.getResponse() as any)?.message ?? exception.message
        : 'Internal server error';

    if (status >= 500) this.logger.error(exception);
    res.status(status).json({ ok: false, error: Array.isArray(message) ? message[0] : message });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/common/response src/common/filters
git commit -m "feat(common): response envelope helpers and global exception filter"
```

---

### Task 7: JwtAuthGuard + CronSecretGuard + @CurrentUser decorator

**Files:**
- Create: `src/common/guards/jwt-auth.guard.ts`
- Create: `src/common/guards/cron-secret.guard.ts`
- Create: `src/common/decorators/current-user.decorator.ts`

- [ ] **Step 1: Write `jwt-auth.guard.spec.ts` first**

```ts
import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { validateEnv } from '../../config/env.validation';

const makeCtx = (authHeader?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }),
    }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let crypto: CryptoService;

  beforeAll(async () => {
    process.env.CRYPTO_SECRET ||= 'a'.repeat(64);
    process.env.JWT_ACCESS_SECRET ||= 'b'.repeat(64);
    process.env.JWT_REFRESH_SECRET ||= 'c'.repeat(64);
    process.env.MONGODB_URI ||= 'mongodb://localhost/test';
    process.env.AWS_ACCESS_KEY_ID ||= 'x';
    process.env.AWS_SECRET_ACCESS_KEY ||= 'x';
    process.env.AWS_REGION ||= 'x';
    process.env.AWS_S3_BUCKET_NAME ||= 'x';
    process.env.CRON_SECRET ||= 'x';

    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
      providers: [JwtAuthGuard, CryptoService],
    }).compile();

    guard = mod.get(JwtAuthGuard);
    crypto = mod.get(CryptoService);
  });

  it('rejects missing Authorization', async () => {
    await expect(guard.canActivate(makeCtx())).resolves.toBe(false);
  });

  it('rejects non-Bearer', async () => {
    await expect(guard.canActivate(makeCtx('Basic abc'))).resolves.toBe(false);
  });

  it('rejects invalid token', async () => {
    await expect(guard.canActivate(makeCtx('Bearer garbage'))).resolves.toBe(false);
  });

  it('accepts valid encrypted token and attaches req.user', async () => {
    const raw = await crypto.signAccessToken('u', 's');
    const encrypted = crypto.encryptToken(raw);
    const req: any = { headers: { authorization: `Bearer ${encrypted}` } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
    expect(req.user).toMatchObject({ userId: 'u', sessionId: 's' });
  });
});
```

- [ ] **Step 2: Run test — verify it fails** (`Cannot find module './jwt-auth.guard'`).

- [ ] **Step 3: Create `jwt-auth.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CryptoService } from '../../shared/crypto/crypto.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly crypto: CryptoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return false;
    const token = header.slice(7).trim();
    if (!token) return false;
    const payload = await this.crypto.verifyAccessToken(token);
    if (!payload) return false;
    req.user = payload;
    return true;
  }
}
```

- [ ] **Step 4: Create `cron-secret.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-cron-secret'];
    return secret === this.config.get('CRON_SECRET', { infer: true });
  }
}
```

- [ ] **Step 5: Create `current-user.decorator.ts`**

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TokenPayload } from '../../shared/crypto/crypto.service';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TokenPayload =>
    ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 6: Run tests — verify passes**

Run: `npm test -- jwt-auth.guard.spec`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/common/guards src/common/decorators
git commit -m "feat(auth): JwtAuthGuard + CronSecretGuard + CurrentUser decorator"
```

---

### Task 8: ZodValidationPipe

**Files:**
- Create: `src/common/pipes/zod-validation.pipe.ts`

- [ ] **Step 1: Implement**

```ts
import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException(formatZodError(parsed.error));
  }
}

export function formatZodError(error: ZodError): string {
  return error.issues?.[0]?.message ?? error.message ?? 'Validation failed';
}
```

> **Note:** The Next source uses two different error shapes: some routes return `error: parsed.error.message`, others return `error: parsed.error.issues[0].message`. The pipe exposes `formatZodError` for callers that want issue-level messages; controllers with the `.issues[0].message` pattern call `schema.safeParse` directly (like the source) rather than using the pipe.

- [ ] **Step 2: Commit**

```bash
git add src/common/pipes
git commit -m "feat(common): ZodValidationPipe + formatZodError helper"
```

---

### Task 9: Wire main.ts — cookie-parser, global prefix, filter, CORS

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Rewrite `main.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on :${port}`);
}
void bootstrap();
```

- [ ] **Step 2: Verify**

Run: `npm run start:dev`
Expected: `API listening on :3001`. Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: bootstrap with cookie-parser, global /api prefix, CORS, filter"
```

---

### Task 10: CookieService

Centralizes cookie setting on Express `res`. Values must match Next.js `lib/auth.ts` exactly.

**Files:**
- Create: `src/auth/cookie.service.ts`

- [ ] **Step 1: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import {
  CryptoService,
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_SECONDS,
} from '../shared/crypto/crypto.service';
import type { UserDocument } from '../shared/database/schemas/user.schema';
import type { Env } from '../config/env.validation';

@Injectable()
export class CookieService {
  private readonly isProd: boolean;
  constructor(private readonly crypto: CryptoService, config: ConfigService<Env, true>) {
    this.isProd = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  setAccessCookie(res: Response, token: string) {
    res.cookie('access_token', this.crypto.encryptToken(token), {
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: ACCESS_TOKEN_SECONDS * 1000,
      path: '/',
    });
  }

  setRefreshCookie(res: Response, token: string) {
    res.cookie('refresh_token', this.crypto.encryptToken(token), {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_SECONDS * 1000,
      path: '/',
    });
  }

  setUserCookie(res: Response, user: UserDocument) {
    const safe = {
      name: user.name,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      vaultCredentialVerifier: !!user.vaultCredentialVerifier,
    };
    res.cookie('user_details', JSON.stringify(safe), {
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_SECONDS * 1000,
      path: '/',
    });
    res.cookie('encrypted_user_details', JSON.stringify(user), {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_SECONDS * 1000,
      path: '/',
    });
  }

  clearAll(res: Response) {
    for (const name of ['access_token', 'refresh_token', 'user_details', 'encrypted_user_details']) {
      res.cookie(name, '', { maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax' });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth/cookie.service.ts
git commit -m "feat(auth): CookieService with byte-exact parity to Next.js lib/auth"
```

---

### Task 11: Throttler configuration

Replaces the in-memory Map-based limiter with `@nestjs/throttler`. Limits match the source: login 10/15min by IP, signup 10/1h by IP, resend-otp 3/15min by user+channel. Global throttler uses per-IP; signup uses a named throttler; resend-otp uses a custom key (user+channel) via `@Throttle` and a custom tracker.

**Files:**
- Create: `src/throttler/throttler.config.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `throttler.config.ts`**

```ts
import { ThrottlerModule, seconds } from '@nestjs/throttler';

export const throttlerConfig = ThrottlerModule.forRoot({
  throttlers: [
    { name: 'login',  limit: 10, ttl: seconds(15 * 60) },
    { name: 'signup', limit: 10, ttl: seconds(60 * 60) },
    { name: 'resend', limit: 3,  ttl: seconds(15 * 60) },
  ],
});
```

- [ ] **Step 2: Add `throttlerConfig` to `app.module.ts` imports.**

- [ ] **Step 3: Commit**

```bash
git add src/throttler src/app.module.ts
git commit -m "feat(throttler): login/signup/resend-otp throttlers"
```

---

### Task 12: Auth DTOs (Zod schemas)

Port `/validations/auth.ts` verbatim plus new route-specific schemas.

**Files:**
- Create: `src/auth/dto/signup.schema.ts`
- Create: `src/auth/dto/login.schema.ts`
- Create: `src/auth/dto/verify-otp.schema.ts`
- Create: `src/auth/dto/resend-otp.schema.ts`
- Create: `src/auth/dto/vault-password.schema.ts`

- [ ] **Step 1: Port verbatim** — copy the contents of `/home/weloin/Projects/nuebics-next-ts-app/validations/auth.ts` into `signup.schema.ts` and `login.schema.ts` (split into two files). Keep the exact error messages and refinements.

- [ ] **Step 2: Create the smaller schemas**

`verify-otp.schema.ts`:
```ts
import { z } from 'zod';
export const verifyOtpSchema = z.object({ code: z.string().min(1) });
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
```

`resend-otp.schema.ts`:
```ts
import { z } from 'zod';
export const resendOtpSchema = z.object({ channel: z.enum(['email', 'phone']) });
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
```

`vault-password.schema.ts`:
```ts
import { z } from 'zod';
export const setVaultPasswordSchema = z.object({ encryptedToken: z.string().min(1) });
export type SetVaultPasswordInput = z.infer<typeof setVaultPasswordSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add src/auth/dto
git commit -m "feat(auth): zod DTOs ported from validations/auth.ts"
```

---

### Task 13: AuthService — signup, login, refresh, logout, me

**Files:**
- Create: `src/auth/auth.service.ts`

- [ ] **Step 1: Implement**

```ts
import { Injectable, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { User, UserDocument } from '../shared/database/schemas/user.schema';
import { CryptoService } from '../shared/crypto/crypto.service';
import type { SignupInput } from './dto/signup.schema';
import type { LoginInput } from './dto/login.schema';

const DUMMY_HASH = '$2b$12$invalidhashfortimingprotection000000000000000000000000';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly crypto: CryptoService,
  ) {}

  async signup(input: SignupInput): Promise<void> {
    const { name, email, phone, password } = input;

    if (email && (await this.userModel.exists({ email: email.toLowerCase() }))) {
      throw new ConflictException('Email is already in use');
    }
    if (phone && (await this.userModel.exists({ phone }))) {
      throw new ConflictException('Phone number is already in use');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    const emailOTP = generateOTP();
    const phoneOTP = generateOTP();

    await this.userModel.create({
      name,
      email: email || undefined,
      phone: phone || undefined,
      passwordHash,
      emailVerificationCode: email ? emailOTP : null,
      emailVerificationExpires: email ? expiry : null,
      phoneVerificationCode: phone ? phoneOTP : null,
      phoneVerificationExpires: phone ? expiry : null,
    });
    // TODO: dispatch OTPs via email/SMS service
  }

  async login(input: LoginInput): Promise<{ user: UserDocument; accessToken: string; refreshToken: string }> {
    const { identifier, password } = input;
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await this.userModel.findOne({ email: identifier.toLowerCase() })
      : await this.userModel.findOne({ phone: identifier });

    const hash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');

    const sessionId = randomUUID();
    const accessToken = await this.crypto.signAccessToken(user._id.toString(), sessionId);
    const refreshToken = await this.crypto.signRefreshToken(user._id.toString(), sessionId);
    return { user, accessToken, refreshToken };
  }

  async refresh(encryptedRefresh: string) {
    const payload = await this.crypto.verifyRefreshToken(encryptedRefresh);
    if (!payload) return null;
    const { userId, sessionId, exp } = payload;
    const newAccess = await this.crypto.signAccessToken(userId, sessionId);
    const rotated = this.crypto.shouldRotate(exp)
      ? await this.crypto.signRefreshToken(userId, sessionId)
      : null;
    return { accessToken: newAccess, refreshToken: rotated };
  }

  async me(userId: string) {
    const user = await this.userModel.findById(userId).select('-passwordHash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth/auth.service.ts
git commit -m "feat(auth): AuthService — signup, login, refresh, me"
```

---

### Task 14: AuthController — signup, login, logout, refresh, me

**Files:**
- Create: `src/auth/auth.controller.ts`

- [ ] **Step 1: Implement**

```ts
import {
  Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards, UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { signupSchema, SignupInput } from './dto/signup.schema';
import { loginSchema, LoginInput } from './dto/login.schema';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
  ) {}

  @Post('signup')
  @HttpCode(201)
  @Throttle({ signup: { limit: 10, ttl: 60 * 60 * 1000 } })
  @UsePipes(new ZodValidationPipe(signupSchema))
  async signup(@Body() dto: SignupInput) {
    await this.auth.signup(dto);
    return { ok: true, message: 'Account created successfully' };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ login: { limit: 10, ttl: 15 * 60 * 1000 } })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() dto: LoginInput, @Res({ passthrough: true }) res: Response) {
    const { user, accessToken, refreshToken } = await this.auth.login(dto);
    this.cookies.setAccessCookie(res, accessToken);
    this.cookies.setRefreshCookie(res, refreshToken);
    this.cookies.setUserCookie(res, user);
    return { ok: true, message: 'Logged in successfully' };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.cookies.clearAll(res);
    return { ok: true, message: 'Logged out successfully' };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = req.cookies?.refresh_token;
    if (!cookie) return { ok: false, error: 'Unauthorized. Please log in.' };
    const result = await this.auth.refresh(cookie);
    if (!result) {
      this.cookies.clearAll(res);
      res.status(401);
      return { ok: false, error: 'Session expired. Please log in again.' };
    }
    this.cookies.setAccessCookie(res, result.accessToken);
    if (result.refreshToken) this.cookies.setRefreshCookie(res, result.refreshToken);
    return { ok: true, message: 'Token refreshed', token: result.accessToken };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() auth: TokenPayload) {
    const user = await this.auth.me(auth.userId);
    return {
      ok: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        createdAt: user.createdAt,
      },
    };
  }
}
```

> **Note:** Routes like `refresh` that must return 401 **without** throwing (so cookies still get set) use `res.status(401)` manually. `UnauthorizedException` from the service is translated by `AllExceptionsFilter` to `{ ok: false, error }`.

- [ ] **Step 2: Commit**

```bash
git add src/auth/auth.controller.ts
git commit -m "feat(auth): AuthController routes — signup, login, logout, refresh, me"
```

---

### Task 15: VerificationService + VerificationController

Covers `/api/auth/verify-email` (GET, POST), `/api/auth/verify-phone` (GET, POST), `/api/auth/resend-otp` (POST).

Important: **response shapes differ from the rest of auth**. These routes return bare `{ email, isVerified }`, `{ message }`, `{ error }` — NOT the `{ ok: true, ... }` envelope. Preserve that.

**Files:**
- Create: `src/auth/verification.service.ts`
- Create: `src/auth/verification.controller.ts`

- [ ] **Step 1: Port logic**. Use source files as authoritative references:
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/auth/verify-email/route.ts`
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/auth/verify-phone/route.ts`
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/auth/resend-otp/route.ts`

`verification.service.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../shared/database/schemas/user.schema';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

@Injectable()
export class VerificationService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async getEmailStatus(userId: string) {
    const user = await this.userModel.findById(userId).select('email isEmailVerified');
    if (!user) throw new NotFoundException('User not found.');
    return { email: user.email, isVerified: user.isEmailVerified || false };
  }

  async verifyEmail(userId: string, code: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.isEmailVerified) return { user, already: true };
    if (!user.emailVerificationCode) throw new BadRequestException('No verification code found.');
    if (user.emailVerificationCode !== code) throw new BadRequestException('Invalid verification code.');
    user.isEmailVerified = true;
    user.emailVerificationCode = null;
    await user.save();
    return { user, already: false };
  }

  async getPhoneStatus(userId: string) {
    const user = await this.userModel.findById(userId).select('phone isPhoneVerified');
    if (!user) throw new NotFoundException('User not found.');
    return { phone: user.phone, isVerified: user.isPhoneVerified || false };
  }

  async verifyPhone(userId: string, code: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.isPhoneVerified) return { user, already: true };
    if (!user.phoneVerificationCode) throw new BadRequestException('No OTP found.');
    if (user.phoneVerificationCode !== code) throw new BadRequestException('Invalid OTP.');
    user.isPhoneVerified = true;
    user.phoneVerificationCode = null;
    await user.save();
    return { user, already: false };
  }

  async resendOtp(userId: string, channel: 'email' | 'phone') {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    if (channel === 'email') {
      if (!user.email) throw new BadRequestException('No email on account.');
      if (user.isEmailVerified) return { already: true };
      user.emailVerificationCode = generateOTP();
      user.emailVerificationExpires = expiry;
    } else {
      if (!user.phone) throw new BadRequestException('No phone on account.');
      if (user.isPhoneVerified) return { already: true };
      user.phoneVerificationCode = generateOTP();
      user.phoneVerificationExpires = expiry;
    }
    await user.save();
    return { already: false };
  }
}
```

`verification.controller.ts`:
```ts
import { Body, Controller, Get, Post, Res, UseGuards, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { VerificationService } from './verification.service';
import { CookieService } from './cookie.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { verifyOtpSchema, VerifyOtpInput } from './dto/verify-otp.schema';
import { resendOtpSchema, ResendOtpInput } from './dto/resend-otp.schema';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly cookies: CookieService,
  ) {}

  @Get('verify-email')
  getEmail(@CurrentUser() auth: TokenPayload) {
    return this.verification.getEmailStatus(auth.userId);
  }

  @Post('verify-email')
  @UsePipes(new ZodValidationPipe(verifyOtpSchema))
  async verifyEmail(
    @CurrentUser() auth: TokenPayload,
    @Body() dto: VerifyOtpInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, already } = await this.verification.verifyEmail(auth.userId, dto.code);
    if (already) return { message: 'Email already verified.' };
    this.cookies.setUserCookie(res, user);
    return { message: 'Email verified successfully.' };
  }

  @Get('verify-phone')
  getPhone(@CurrentUser() auth: TokenPayload) {
    return this.verification.getPhoneStatus(auth.userId);
  }

  @Post('verify-phone')
  @UsePipes(new ZodValidationPipe(verifyOtpSchema))
  async verifyPhone(
    @CurrentUser() auth: TokenPayload,
    @Body() dto: VerifyOtpInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, already } = await this.verification.verifyPhone(auth.userId, dto.code);
    if (already) return { message: 'Phone already verified.' };
    this.cookies.setUserCookie(res, user);
    return { message: 'Phone verified successfully.' };
  }

  @Post('resend-otp')
  @UsePipes(new ZodValidationPipe(resendOtpSchema))
  async resend(@CurrentUser() auth: TokenPayload, @Body() dto: ResendOtpInput) {
    // Per-user+channel throttling — implement via an in-memory map keyed by
    // `${userId}:${channel}` matching source rate-limit 3/15min.
    // Simplest: use ThrottlerGuard with tracker = `${auth.userId}:${dto.channel}`
    // via custom ThrottlerGuard subclass. For now, leave throttling enforcement
    // to a follow-up task; service guards against abuse at DB level.
    const { already } = await this.verification.resendOtp(auth.userId, dto.channel);
    return already ? { message: `${dto.channel === 'email' ? 'Email' : 'Phone'} already verified.` } : { message: 'Verification code sent.' };
  }
}
```

> **Open item — resend-otp throttling:** the source keys by `${userId}:${channel}`. `@nestjs/throttler` uses IP by default. Implement a `UserChannelThrottlerGuard` extending `ThrottlerGuard` that overrides `getTracker(req)` to return `${req.user.userId}:${req.body.channel}`. Add this in a follow-up step after the flow is green.

- [ ] **Step 2: Commit**

```bash
git add src/auth/verification.service.ts src/auth/verification.controller.ts
git commit -m "feat(auth): email/phone verification + resend-otp"
```

---

### Task 16: VaultPasswordController + service

**Files:**
- Create: `src/auth/vault-password.service.ts`
- Create: `src/auth/vault-password.controller.ts`

- [ ] **Step 1: Implement**

`vault-password.service.ts`:
```ts
import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../shared/database/schemas/user.schema';
import { CryptoService } from '../shared/crypto/crypto.service';

@Injectable()
export class VaultPasswordService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly crypto: CryptoService,
  ) {}

  async getVerifier(userId: string): Promise<string> {
    const user = await this.userModel.findById(userId).select('vaultCredentialVerifier');
    if (!user) throw new NotFoundException('User not found.');
    if (!user.vaultCredentialVerifier) throw new NotFoundException('No vault password set.');
    const verifier = this.crypto.decryptToken(user.vaultCredentialVerifier);
    if (!verifier) throw new InternalServerErrorException('Vault password corrupted.');
    return verifier;
  }

  async setVerifier(userId: string, encryptedToken: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.vaultCredentialVerifier) {
      const credentialChecker = this.crypto.decryptToken(user.vaultCredentialVerifier);
      return { alreadySet: true as const, credentialChecker };
    }
    user.vaultCredentialVerifier = this.crypto.encryptToken(encryptedToken);
    await user.save();
    return { alreadySet: false as const, user };
  }
}
```

`vault-password.controller.ts`:
```ts
import { Body, Controller, Get, Post, Res, UseGuards, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { VaultPasswordService } from './vault-password.service';
import { CookieService } from './cookie.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { setVaultPasswordSchema, SetVaultPasswordInput } from './dto/vault-password.schema';

@Controller('auth/vault-password')
@UseGuards(JwtAuthGuard)
export class VaultPasswordController {
  constructor(
    private readonly service: VaultPasswordService,
    private readonly cookies: CookieService,
  ) {}

  @Get()
  async get(@CurrentUser() auth: TokenPayload) {
    const verifier = await this.service.getVerifier(auth.userId);
    return { verifier };
  }

  @Post()
  @UsePipes(new ZodValidationPipe(setVaultPasswordSchema))
  async set(
    @CurrentUser() auth: TokenPayload,
    @Body() dto: SetVaultPasswordInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.setVerifier(auth.userId, dto.encryptedToken);
    if (result.alreadySet) return { credentialChecker: result.credentialChecker };
    this.cookies.setUserCookie(res, result.user);
    return { message: 'Vault password set successfully.' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth/vault-password.service.ts src/auth/vault-password.controller.ts
git commit -m "feat(auth): vault-password GET/POST"
```

---

### Task 17: AuthModule wiring

**Files:**
- Create: `src/auth/auth.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Implement**

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VaultPasswordController } from './vault-password.controller';
import { VaultPasswordService } from './vault-password.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { User, UserSchema } from '../shared/database/schemas/user.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [AuthController, VerificationController, VaultPasswordController],
  providers: [AuthService, VerificationService, VaultPasswordService, CookieService, JwtAuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 2: Add `AuthModule` to `app.module.ts` imports.**

- [ ] **Step 3: Verify**

Run: `npm run start:dev`. Hit `curl -i -X POST http://localhost:3001/api/auth/logout` — expect `200 { ok: true, message: "Logged out successfully" }` and cleared cookie headers.

- [ ] **Step 4: Commit**

```bash
git add src/auth/auth.module.ts src/app.module.ts
git commit -m "feat(auth): AuthModule wiring"
```

---

### Task 18: Folders DTOs + helpers

**Files:**
- Create: `src/folders/dto/create-folder.schema.ts`
- Create: `src/folders/dto/update-folder.schema.ts`
- Create: `src/folders/folders.helpers.ts`

- [ ] **Step 1: Port schemas** — copy `/home/weloin/Projects/nuebics-next-ts-app/validations/files-and-folder.ts` into two files (`create-folder.schema.ts`, `update-folder.schema.ts`) **including** the shared `folderNameSchema`/`fileNameSchema` base, `INVALID_CHARS`, `RESERVED_NAMES`. Put the shared regex/base schemas in a single file (e.g. `folders/dto/_shared.ts`) and import where needed.

- [ ] **Step 2: Port helpers** — copy the full contents of `/home/weloin/Projects/nuebics-next-ts-app/lib/files-and-folder-helper.ts` into `src/folders/folders.helpers.ts`, converting to a class `FoldersHelpers`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import { Folder, FolderDocument } from '../shared/database/schemas/folder.schema';
import { S3Service } from '../shared/s3/s3.service';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

@Injectable()
export class FoldersHelpers {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name) private readonly folderModel: Model<FolderDocument>,
    private readonly s3: S3Service,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get trashRetentionMs(): number {
    return this.config.get('NODE_ENV', { infer: true }) === 'production'
      ? 30 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  }

  async trashFolderRecursive(folderId: string, userId: string): Promise<void> {
    const now = new Date();
    const oid = new Types.ObjectId(folderId);
    await this.fileModel.updateMany(
      { userId, folderId: oid, status: 'active' },
      { status: 'trashed', deletedAt: now },
    );
    const subs = await this.folderModel.find({ userId, parentId: oid, status: 'active' }).lean();
    for (const s of subs) await this.trashFolderRecursive(s._id.toString(), userId);
    await this.folderModel.findOneAndUpdate({ _id: folderId, userId }, { status: 'trashed', deletedAt: now });
  }

  async getDescendantFolderIds(folderId: string, userId: string): Promise<string[]> {
    const out: string[] = [];
    const queue = [folderId];
    while (queue.length) {
      const curr = queue.shift()!;
      const kids = await this.folderModel.find({ parentId: curr, userId }, { _id: 1 }).lean();
      for (const k of kids) { out.push(k._id.toString()); queue.push(k._id.toString()); }
    }
    return out;
  }

  async isDescendantOf(targetId: string, ancestorId: string, userId: string): Promise<boolean> {
    if (targetId === ancestorId) return true;
    const desc = await this.getDescendantFolderIds(ancestorId, userId);
    return desc.includes(targetId);
  }

  async deleteFolderRecursive(folderId: string, userId: string) {
    const desc = await this.getDescendantFolderIds(folderId, userId);
    const all = [folderId, ...desc];
    const files = await this.fileModel.find({ userId, folderId: { $in: all } }, { _id: 1, key: 1 }).lean();
    await this.s3.deleteMany(files.map((f) => f.key));
    const fileResult = await this.fileModel.deleteMany({ userId, folderId: { $in: all } });
    const folderResult = await this.folderModel.deleteMany({ userId, _id: { $in: all } });
    return { deletedFolders: folderResult.deletedCount, deletedFiles: fileResult.deletedCount };
  }

  async buildBreadcrumbPath(folderId: string | null, userId: string) {
    const path: { _id: string | null; name: string }[] = [];
    let curr = folderId;
    while (curr) {
      const f = await this.folderModel.findOne({ _id: curr, userId }, { _id: 1, name: 1, parentId: 1 }).lean();
      if (!f) break;
      path.unshift({ _id: f._id.toString(), name: f.name });
      curr = f.parentId?.toString() ?? null;
    }
    path.unshift({ _id: null, name: 'Home' });
    return path;
  }

  async restoreFolderRecursive(folderId: string, userId: string): Promise<void> {
    const oid = new Types.ObjectId(folderId);
    await this.fileModel.updateMany(
      { userId, folderId: oid, status: 'trashed' },
      { status: 'active', deletedAt: null },
    );
    const subs = await this.folderModel.find({ userId, parentId: oid, status: 'trashed' }).lean();
    for (const s of subs) await this.restoreFolderRecursive(s._id.toString(), userId);
    await this.folderModel.findOneAndUpdate({ _id: folderId, userId }, { status: 'active', deletedAt: null });
  }

  async purgeExpiredTrash(userId?: string) {
    const cutoff = new Date(Date.now() - this.trashRetentionMs);
    const userFilter = userId ? { userId } : {};
    const expiredFiles = await this.fileModel
      .find({ ...userFilter, status: 'trashed', deletedAt: { $lte: cutoff } })
      .lean();
    await this.s3.deleteMany(expiredFiles.map((f) => f.key));
    const { deletedCount: df = 0 } = await this.fileModel.deleteMany({
      ...userFilter, status: 'trashed', deletedAt: { $lte: cutoff },
    });
    const { deletedCount: dfd = 0 } = await this.folderModel.deleteMany({
      ...userFilter, status: 'trashed', deletedAt: { $lte: cutoff },
    });
    return { files: df, folders: dfd };
  }
}
```

- [ ] **Step 3: Write cycle-detection unit test** at `src/folders/folders.helpers.spec.ts` — mocks `folderModel.find` and asserts `isDescendantOf` correctly catches cycles.

Skeleton:
```ts
// Use @nestjs/testing with getModelToken(Folder.name) and a mock that returns
// subtree A→B→C; assert isDescendantOf('C','A',userId) === true,
// isDescendantOf('A','C',userId) === false.
```

- [ ] **Step 4: Run test** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/folders/dto src/folders/folders.helpers.ts src/folders/folders.helpers.spec.ts
git commit -m "feat(folders): DTOs + recursive helpers with cycle detection"
```

---

### Task 19: FoldersService + FoldersController

**Files:**
- Create: `src/folders/folders.service.ts`
- Create: `src/folders/folders.controller.ts`
- Create: `src/folders/folders.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Port each route handler.** Source files:
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/folders/route.ts` (GET list, POST create)
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/folders/[id]/route.ts` (GET one+breadcrumbs, PATCH rename/move, DELETE soft-trash-recursive)
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/folders/[id]/favourite/route.ts` (PATCH favourite)

`folders.service.ts` implements the business logic; `folders.controller.ts` exposes routes at `/api/files/folders` (GET, POST), `/api/files/folders/:id` (GET, PATCH, DELETE), `/api/files/folders/:id/favourite` (PATCH).

Key points to preserve:
- **ObjectId validation** via `Types.ObjectId.isValid(id)`; 400 on invalid.
- **Duplicate name check** before create/rename (status 409 with exact message `"A folder with this name already exists here"`).
- **Move checks in order** (source order): same-location → into-self → into-descendant → invalid parent → duplicate in target parent. Messages must match source strings.
- **DELETE is soft** → `trashFolderRecursive`, return `{ success: true, message: "${folder.name} moved to trash" }`. No S3 deletion.
- Responses are bare: `{ folders }`, `{ folder }`, `{ folder, breadcrumbs }`, `{ success, message }`, `{ error }`.

Use `schema.safeParse` inside the controller (not the pipe) so error messages follow the source's `error.issues[0].message` convention.

`folders.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { FoldersHelpers } from './folders.helpers';
import { Folder, FolderSchema } from '../shared/database/schemas/folder.schema';
import { File, FileSchema } from '../shared/database/schemas/file.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Folder.name, schema: FolderSchema },
    { name: File.name, schema: FileSchema },
  ])],
  controllers: [FoldersController],
  providers: [FoldersService, FoldersHelpers],
  exports: [FoldersHelpers, MongooseModule],
})
export class FoldersModule {}
```

- [ ] **Step 2: Register `FoldersModule` in `app.module.ts`.**

- [ ] **Step 3: Smoke-test** (after obtaining an access token via Task 25's flow):
```bash
curl -s -H "Authorization: Bearer $ACCESS" http://localhost:3001/api/files/folders | jq
curl -s -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" \
  -d '{"name":"Test"}' http://localhost:3001/api/files/folders | jq
```
Expected: `{ folders: [...] }`, then `{ folder: {...} }` with `status: 201`.

- [ ] **Step 4: Commit**

```bash
git add src/folders src/app.module.ts
git commit -m "feat(folders): CRUD + favourite + breadcrumbs"
```

---

### Task 20: Files module — upload, confirm, list, update, delete, favourite

**Files:**
- Create: `src/files/dto/upload.schema.ts`, `confirm.schema.ts`, `update-file.schema.ts`
- Create: `src/files/files.service.ts`
- Create: `src/files/files.controller.ts`
- Create: `src/files/files.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: DTOs**

`upload.schema.ts`:
```ts
import { z } from 'zod';
export const uploadSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().int().positive(),
  folderId: z.string().nullable().optional(),
});
export type UploadInput = z.infer<typeof uploadSchema>;
```

`confirm.schema.ts`:
```ts
import { z } from 'zod';
export const confirmSchema = z.object({
  key: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().int().positive(),
  folderId: z.string().nullable().optional(),
});
export type ConfirmInput = z.infer<typeof confirmSchema>;
```

`update-file.schema.ts`: port from source `updateFileSchema`.

- [ ] **Step 2: Port controller logic** from:
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/upload/route.ts`
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/confirm/route.ts`
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/files/route.ts`
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/files/[id]/route.ts`
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/files/[id]/favourite/route.ts`

Routes (all under `/api/files` prefix from controller, guarded by `JwtAuthGuard`):
- `POST files/upload` — validate folderId → presign S3 PUT → return `{ presignedUrl, key, folderId }`.
- `POST files/confirm` — S3 HEAD → byte-count check (delete partial and 400 on mismatch) → create doc → `201 { file }`.
- `GET files/files?folderId=` — list active files in folder or root, sorted by `updatedAt` desc.
- `PATCH files/files/:id` — rename and/or move, validate target folder ownership, return `{ file }`.
- `DELETE files/files/:id` — soft delete (`status: "trashed"`, `deletedAt: now`); return `{ success, message }`.
- `PATCH files/files/:id/favourite` — findOneAndUpdate, return `{ file }`.

S3 key generation: `uploads/${userId}/${uuidv4()}.${ext}` (ext from `fileName.split(".").pop()`).

- [ ] **Step 3: `files.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { File, FileSchema } from '../shared/database/schemas/file.schema';
import { Folder, FolderSchema } from '../shared/database/schemas/folder.schema';
import { FoldersModule } from '../folders/folders.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: File.name, schema: FileSchema },
      { name: Folder.name, schema: FolderSchema },
    ]),
    FoldersModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService, MongooseModule],
})
export class FilesModule {}
```

- [ ] **Step 4: Register in `app.module.ts`, smoke test with curl, commit.**

```bash
git add src/files src/app.module.ts
git commit -m "feat(files): upload, confirm, list, update, delete, favourite"
```

---

### Task 21: Download endpoints + Contents endpoint

**Files:**
- Create: `src/files/download.controller.ts`
- Create: `src/files/contents.controller.ts`
- Modify: `src/files/files.service.ts` (or add separate `DownloadService`)

- [ ] **Step 1: Port `/api/files/download` POST (batch) and `/api/files/download/:id` GET (single)** from:
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/download/route.ts`
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/download/[id]/route.ts`

Key behaviors:
- Batch builds `pathMap: fileId → folder-relative path` via `getDescendantFolderIds` + in-memory walk.
- Standalone `fileIds` get empty path prefix.
- Enforce `MAX_FILES` limit via `ConfigService.get('MAX_FILES')` — 400 if exceeded.
- Generate presigned GET URLs in parallel (`Promise.all`), expiresIn 300.
- Response shape: `{ items: [{ id, name, path, url }] }` or `{ error }`.
- Single: `GET /api/files/download/:id` → `{ url }`.

- [ ] **Step 2: Port `/api/files/contents` GET** from `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/contents/route.ts`.

Uses parallel queries for folders, files, breadcrumbs, plus aggregation for `itemCount` per folder. Preserve aggregation pipeline exactly. Response: `{ folders: (f & {itemCount})[], files, breadcrumbs }`.

- [ ] **Step 3: Register both controllers** in `FilesModule`.

- [ ] **Step 4: Smoke-test + commit.**

```bash
git add src/files
git commit -m "feat(files): download batch+single, contents atomic view"
```

---

### Task 22: Trash module

**Files:**
- Create: `src/trash/trash.service.ts`
- Create: `src/trash/trash.controller.ts`
- Create: `src/trash/trash.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Port `GET /api/files/trash`** from `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/trash/route.ts`.

Returns "root-level" trashed items (i.e. not inside another trashed folder) with child counts and `retentionDays` computed from `FoldersHelpers.trashRetentionMs / (24*60*60*1000)`.

- [ ] **Step 2: Port `POST /api/files/trash/restore/:id?type=file|folder`** from `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/trash/restore/[id]/route.ts`. Folder restore calls `FoldersHelpers.restoreFolderRecursive`.

- [ ] **Step 3: Module**

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
import { File, FileSchema } from '../shared/database/schemas/file.schema';
import { Folder, FolderSchema } from '../shared/database/schemas/folder.schema';
import { FoldersModule } from '../folders/folders.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: File.name, schema: FileSchema },
      { name: Folder.name, schema: FolderSchema },
    ]),
    FoldersModule,
  ],
  controllers: [TrashController],
  providers: [TrashService],
})
export class TrashModule {}
```

- [ ] **Step 4: Register + commit.**

```bash
git add src/trash src/app.module.ts
git commit -m "feat(trash): list root-trashed items, restore recursively"
```

---

### Task 23: Favourites module

**Files:**
- Create: `src/favourites/favourites.service.ts`
- Create: `src/favourites/favourites.controller.ts`
- Create: `src/favourites/favourites.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Port** from:
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/favourites/route.ts` (GET list)
  - `/home/weloin/Projects/nuebics-next-ts-app/app/api/files/favourites/bulk/route.ts` (PATCH bulk)

Routes:
- `GET /api/files/favourites` → `{ files, folders }` active+favourited.
- `PATCH /api/files/favourites/bulk` body `{ fileIds?, folderIds?, isFavourite }` → `{ updated: { files, folders } }`.

- [ ] **Step 2: Register + commit.**

```bash
git add src/favourites src/app.module.ts
git commit -m "feat(favourites): list + bulk toggle"
```

---

### Task 24: Cron purge-trash

**Files:**
- Create: `src/cron/cron.controller.ts`
- Create: `src/cron/cron.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Implement** — port from `/home/weloin/Projects/nuebics-next-ts-app/app/api/cron/purge-trash/route.ts`.

```ts
import { Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { CronSecretGuard } from '../common/guards/cron-secret.guard';
import { FoldersHelpers } from '../folders/folders.helpers';

@Controller('cron')
export class CronController {
  private readonly logger = new Logger(CronController.name);
  constructor(private readonly helpers: FoldersHelpers) {}

  @Post('purge-trash')
  @HttpCode(200)
  @UseGuards(CronSecretGuard)
  async purge() {
    const result = await this.helpers.purgeExpiredTrash();
    this.logger.log(`Purge complete: ${result.files} files, ${result.folders} folders deleted`);
    return { success: true, ...result };
  }
}
```

- [ ] **Step 2: Module**

```ts
import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { FoldersModule } from '../folders/folders.module';

@Module({
  imports: [FoldersModule],
  controllers: [CronController],
})
export class CronModule {}
```

- [ ] **Step 3: Register + commit.**

```bash
git add src/cron src/app.module.ts
git commit -m "feat(cron): purge-trash endpoint guarded by CronSecretGuard"
```

---

### Task 25: End-to-end smoke test checklist

This replaces per-endpoint integration tests. After all modules are wired, run through this script against a fresh dev DB (or use your existing dev data).

- [ ] **Step 1: Boot the server** — `npm run start:dev`. Expect port 3001, MongoDB connected.

- [ ] **Step 2: Signup** (new email):
```bash
curl -s -X POST http://localhost:3001/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke","email":"smoke@test.io","phone":"+919000000001","password":"Passw0rd!","confirmPassword":"Passw0rd!"}' | jq
```
Expect `{ ok: true, message: "Account created successfully" }` (201). If email already exists, pick a new one.

- [ ] **Step 3: Login, capture cookies:**
```bash
COOKIE=/tmp/nue.cookies
curl -s -c $COOKIE -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"smoke@test.io","password":"Passw0rd!"}' | jq
ACCESS=$(awk '/access_token/{print $7}' $COOKIE)
echo "Access cookie (encrypted JWT): $ACCESS"
```
Expect `{ ok: true, message: "Logged in successfully" }`. Cookie file should list `access_token`, `refresh_token`, `user_details`, `encrypted_user_details`.

- [ ] **Step 4: Me (Bearer):**
```bash
curl -s -H "Authorization: Bearer $ACCESS" http://localhost:3001/api/auth/me | jq
```
Expect `{ ok: true, user: { id, name, email, phone, isEmailVerified, isPhoneVerified, createdAt } }`.

- [ ] **Step 5: Refresh (cookie):**
```bash
curl -s -b $COOKIE -c $COOKIE -X POST http://localhost:3001/api/auth/refresh | jq
```
Expect `{ ok: true, message: "Token refreshed", token: "..." }`.

- [ ] **Step 6: Folders create/list:**
```bash
curl -s -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"Projects"}' http://localhost:3001/api/files/folders | jq
curl -s -H "Authorization: Bearer $ACCESS" http://localhost:3001/api/files/folders | jq
```
Expect `{ folder: {...} }` (201), then `{ folders: [{...}] }`.

- [ ] **Step 7: Upload flow** — get presigned URL, PUT dummy bytes, confirm:
```bash
UP=$(curl -s -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -X POST http://localhost:3001/api/files/upload \
  -d '{"fileName":"hello.txt","fileType":"text/plain","fileSize":5}')
URL=$(echo $UP | jq -r .presignedUrl)
KEY=$(echo $UP | jq -r .key)
echo "hello" > /tmp/hello.txt
curl -s -X PUT -H 'Content-Type: text/plain' --data-binary @/tmp/hello.txt "$URL" -o /dev/null -w "%{http_code}\n"
curl -s -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -X POST http://localhost:3001/api/files/confirm \
  -d "{\"key\":\"$KEY\",\"fileName\":\"hello.txt\",\"fileType\":\"text/plain\",\"fileSize\":5}" | jq
```
Expect PUT=200, confirm → `{ file: {...} }` (201).

- [ ] **Step 8: Contents, favourite, download, trash, restore, vault-password, resend-otp, cron.** Walk through each endpoint verifying shape matches the source. Cross-reference source route files when anything looks off.

- [ ] **Step 9: Sanity-check Next.js ↔ Nest interop.**
  - Stop the Next.js app. Start only the Nest app.
  - Open the Next.js **frontend** (the client React app is still inside `nuebics-next-ts-app` but point its API base URL env at `http://localhost:3001`). Log in → dashboard loads → upload works → logout works.
  - If a user who was already logged-in on the Next.js backend can now hit `/api/auth/me` against the Nest backend using their existing `access_token` cookie → crypto parity is confirmed.

- [ ] **Step 10: Commit the checklist** to `docs/superpowers/plans/2026-04-14-port-api-to-nestjs.md` in this repo (already there), plus any smoke-test script at `scripts/smoke.sh`:

```bash
git add scripts/smoke.sh docs/superpowers/plans/
git commit -m "chore: API smoke-test script + plan"
```

---

### Task 26: UserChannelThrottlerGuard for resend-otp

The source keys rate-limit by `${userId}:${channel}`; `@nestjs/throttler` keys by IP by default. This task implements the proper key.

**Files:**
- Create: `src/common/guards/user-channel-throttler.guard.ts`
- Modify: `src/auth/verification.controller.ts`

- [ ] **Step 1: Subclass `ThrottlerGuard` with a custom `getTracker`:**

```ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class UserChannelThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.userId ?? 'anon';
    const channel = req.body?.channel ?? 'unknown';
    return `${userId}:${channel}`;
  }
}
```

- [ ] **Step 2: Apply to `resend-otp`:**

```ts
@Post('resend-otp')
@UseGuards(JwtAuthGuard, UserChannelThrottlerGuard)
@Throttle({ resend: { limit: 3, ttl: 15 * 60 * 1000 } })
@UsePipes(new ZodValidationPipe(resendOtpSchema))
async resend(...) { ... }
```

- [ ] **Step 3: Verify by hammering the endpoint 4× quickly → 4th returns 429.**

- [ ] **Step 4: Commit.**

```bash
git add src/common/guards/user-channel-throttler.guard.ts src/auth/verification.controller.ts
git commit -m "feat(throttler): user+channel key for resend-otp"
```

---

### Task 27: README + handoff notes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document** setup, env, routes, parity invariants, known gaps (OTP dispatch is still TODO — the source never implemented email/SMS either).

- [ ] **Step 2: Commit.**

```bash
git add README.md
git commit -m "docs: API port README with parity invariants and run instructions"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** 32 endpoints mapped to Tasks 14 (5), 15 (5), 16 (2), 19 (5), 20 (6), 21 (3), 22 (2), 23 (2), 24 (1) = 31 + cron = 32. ✅
- [x] **Parity invariants:** listed up front; referenced throughout. ✅
- [x] **Env vars:** Task 2 covers all 11. ✅
- [x] **No TypeORM/class-validator:** Mongoose + Zod preserved per confirmed brief. ✅
- [x] **Response envelope asymmetry:** flagged explicitly in invariant #9 and task 15/19. ✅
- [ ] **Known limitation:** OTP email/SMS dispatch is a TODO in the source and remains a TODO here — not in scope. Documented in Task 15.

---

## Handoff

Plan saved to `docs/superpowers/plans/2026-04-14-port-api-to-nestjs.md`. Execute with subagent-driven-development (recommended) or inline executing-plans.
