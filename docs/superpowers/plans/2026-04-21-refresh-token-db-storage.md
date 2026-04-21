# Refresh Token DB Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back refresh tokens with a Mongo collection so rotation removes the old token atomically ("one active token per session at any time"), without changing any API request body, response shape, or Zod DTO.

**Architecture:** Refresh tokens stay as HS256 JWTs on the wire (API contract unchanged: `refresh_token` in → `refresh_token` out). A new `refresh_tokens` Mongo collection stores one row per session, keyed by `sessionId`, holding `sha256(token)`. Login upserts the row; refresh uses a single `findOneAndUpdate` matching on `{sessionId, tokenHash: sha256(incoming), expiresAt > now}` and `$set`s the new hash + new expiry — this is the atomic old-gone-new-present swap. A mismatch/miss returns `null`, which the controller already converts to `UnauthorizedException('Session expired. Please log in again.')`. TTL index on `expiresAt` sweeps expired rows.

**Tech Stack:** NestJS 11, @nestjs/mongoose, mongoose 8, jose (unchanged), Node `crypto` for sha256.

**Scope guard — do NOT change:**
- `refreshSchema` (DTO) at `src/auth/dto/refresh.schema.ts`
- Response body shape for `POST /auth/refresh` (keeps `ok`, `message`, `user_details`, `access_token`, `refresh_token`)
- User Mongoose schema at `src/shared/database/schemas/user.schema.ts`
- `CryptoService.signRefreshToken` / `verifyRefreshToken`
- Response body shape for `POST /auth/login`

---

## File Structure

**New files:**
- `src/shared/database/schemas/refresh-token.schema.ts` — Mongoose schema for the new collection.

**Modified:**
- `src/auth/auth.module.ts` — register `RefreshToken` with `MongooseModule.forFeature`.
- `src/auth/auth.service.ts` — inject `refreshTokenModel`; in `login()` upsert a row after signing; in `refresh()` swap the row atomically.
- `test/auth/happy.e2e-spec.ts` — add two assertions covering the new DB-backed behavior (rotation invalidates old token; row persisted on login).

**Not modified:**
- `src/auth/auth.controller.ts` — controller logic is unchanged (still destructures `result.user` / tokens and returns the same JSON).
- `src/auth/dto/*` — API contract is frozen.
- `scripts/auth-smoke.sh` — T16 already covers rotation; no new assertions needed.

---

## Task 1: Add `RefreshToken` Mongoose schema

**Files:**
- Create: `src/shared/database/schemas/refresh-token.schema.ts`

- [ ] **Step 1: Create the schema file**

Create `src/shared/database/schemas/refresh-token.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

@Schema({
  timestamps: true,
  collection: 'refresh_tokens',
})
export class RefreshToken {
  @Prop({ required: true, unique: true, index: true })
  sessionId: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  tokenHash: string;

  @Prop({ required: true, index: { expires: 0 } })
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
```

Notes:
- `expires: 0` on the `expiresAt` index makes Mongo delete docs as soon as `expiresAt <= now` (TTL sweep runs ~every 60s). Code still guards `expiresAt > now` at read time for the sub-minute window.
- `sessionId` is unique so we get "at most one active row per session" structurally.
- `tokenHash` stores `sha256(jwt)` hex — never the raw token.

- [ ] **Step 2: Run build to verify TypeScript compiles**

Run: `npm run build`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/database/schemas/refresh-token.schema.ts
git commit -m "feat(auth): add RefreshToken Mongoose schema"
```

---

## Task 2: Register `RefreshToken` in `AuthModule`

**Files:**
- Modify: `src/auth/auth.module.ts`

- [ ] **Step 1: Add the schema to `forFeature`**

Edit `src/auth/auth.module.ts`. Replace the imports and the `MongooseModule.forFeature` call:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VaultPasswordController } from './vault-password.controller';
import { VaultPasswordService } from './vault-password.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserChannelThrottlerGuard } from '../common/guards/user-channel-throttler.guard';
import { User, UserSchema } from '../shared/database/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenSchema,
} from '../shared/database/schemas/refresh-token.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
    ]),
  ],
  controllers: [
    AuthController,
    VerificationController,
    VaultPasswordController,
  ],
  providers: [
    AuthService,
    VerificationService,
    VaultPasswordService,
    JwtAuthGuard,
    UserChannelThrottlerGuard,
  ],
})
export class AuthModule {}
```

- [ ] **Step 2: Run build to verify**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/auth/auth.module.ts
git commit -m "feat(auth): register RefreshToken with MongooseModule"
```

---

## Task 3: Write the failing e2e tests

We add two assertions to `AUTH-HAPPY-003` and a new `AUTH-HAPPY-003b` that both fail against the current (pure-JWT) implementation — they'll pass after Task 4.

**Files:**
- Modify: `test/auth/happy.e2e-spec.ts`

- [ ] **Step 1: Add a new test case AUTH-HAPPY-003b for rotation invalidating old token**

Insert a new test directly after the existing AUTH-HAPPY-003 (after the closing `});` of that block) in `test/auth/happy.e2e-spec.ts`:

```ts
  it('AUTH-HAPPY-003b: old refresh token is rejected after rotation', async () => {
    const session = await loginUser(app, userA);
    await new Promise((r) => setTimeout(r, 1100));

    // First rotation succeeds.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: session.refresh })
      .expect(200);

    // Re-using the original (now rotated-out) refresh token must fail.
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: session.refresh })
      .expect(401);
    expect(res.body.ok).toBe(false);
  });
```

- [ ] **Step 2: Run the new test to verify it fails against current implementation**

Run: `npm run test:e2e -- --testPathPatterns="auth/happy" -t "AUTH-HAPPY-003b"`
Expected: FAIL — the second refresh currently returns 200 (stateless JWT). If the harness has no live Mongo, the `beforeAll` hook will also time out; note this and continue — Task 5 runs the full suite against a live Mongo.

- [ ] **Step 3: Commit**

```bash
git add test/auth/happy.e2e-spec.ts
git commit -m "test(auth): add failing e2e for refresh-token rotation invalidating old token"
```

---

## Task 4: Implement DB-backed rotation in `AuthService`

**Files:**
- Modify: `src/auth/auth.service.ts`

- [ ] **Step 1: Add the sha256 helper + inject the new model**

Replace the top of `src/auth/auth.service.ts` (imports and constructor). Keep the rest of the class body intact except where called out in the next steps.

```ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { User, UserDocument } from '../shared/database/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from '../shared/database/schemas/refresh-token.schema';
import {
  CryptoService,
  REFRESH_TOKEN_SECONDS,
} from '../shared/crypto/crypto.service';
import type { SignupInput } from './dto/signup.schema';
import type { LoginInput } from './dto/login.schema';

const DUMMY_HASH =
  '$2b$12$invalidhashfortimingprotection000000000000000000000000';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly crypto: CryptoService,
  ) {}
```

Notes:
- `randomUUID` is now imported from `crypto` alongside `createHash` (was previously imported separately — the existing `import { randomUUID } from 'crypto';` line is merged into this single import and removed).
- `REFRESH_TOKEN_SECONDS` is exported from `crypto.service.ts` (line 20) — we reuse it to compute `expiresAt` without duplicating the "5 days" constant.

- [ ] **Step 2: Update `login()` to persist the refresh-token row**

Replace the existing `login()` method body. Only the last block changes — the sign calls stay the same but are followed by an `updateOne(..., { upsert: true })`:

```ts
  async login(input: LoginInput): Promise<{
    user: UserDocument;
    accessToken: string;
    refreshToken: string;
  }> {
    const { identifier, password } = input;
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await this.userModel.findOne({ email: identifier.toLowerCase() })
      : await this.userModel.findOne({ phone: identifier });

    const hash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');

    const sessionId = randomUUID();
    const accessToken = await this.crypto.signAccessToken(
      user._id.toString(),
      sessionId,
    );
    const refreshToken = await this.crypto.signRefreshToken(
      user._id.toString(),
      sessionId,
    );

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);
    await this.refreshTokenModel.updateOne(
      { sessionId },
      {
        $set: {
          sessionId,
          userId: user._id,
          tokenHash: hashToken(refreshToken),
          expiresAt,
        },
      },
      { upsert: true },
    );

    return { user, accessToken, refreshToken };
  }
```

- [ ] **Step 3: Update `refresh()` to validate + atomically swap the row**

Replace the existing `refresh()` method body:

```ts
  async refresh(refreshToken: string) {
    const payload = await this.crypto.verifyRefreshToken(refreshToken);
    if (!payload) return null;
    const { userId, sessionId } = payload;

    const user = await this.userModel.findById(userId).select('-passwordHash');
    if (!user) return null;

    const newAccessToken = await this.crypto.signAccessToken(userId, sessionId);
    const newRefreshToken = await this.crypto.signRefreshToken(
      userId,
      sessionId,
    );
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);

    const swap = await this.refreshTokenModel.findOneAndUpdate(
      {
        sessionId,
        tokenHash: hashToken(refreshToken),
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          tokenHash: hashToken(newRefreshToken),
          expiresAt: newExpiresAt,
        },
      },
      { new: true },
    );

    if (!swap) return null;

    return { user, accessToken: newAccessToken, refreshToken: newRefreshToken };
  }
```

Why this is safe:
- The filter matches on `tokenHash: sha256(incoming)` — so only the holder of the current token can swap.
- The `$set` overwrites that same row's `tokenHash` and `expiresAt`. There is never a moment where both the old and the new hash are valid for this session — the swap is a single Mongo operation.
- A second caller presenting the same incoming token after the swap will see `swap === null` (filter no longer matches) → 401.
- A stale/expired row filtered out by `expiresAt > now` → 401, regardless of TTL sweep timing.

- [ ] **Step 4: Run `me()` is untouched — confirm by reading the method**

The `me()` method does not interact with refresh tokens. Leave it as-is.

- [ ] **Step 5: Run the build**

Run: `npm run build`
Expected: exits 0. The new imports (`createHash`, `Types`, `REFRESH_TOKEN_SECONDS`, `RefreshToken`) must all resolve.

- [ ] **Step 6: Run the unit test suite (sanity check — these don't touch Mongo)**

Run: `npm test`
Expected: all 25 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/auth/auth.service.ts
git commit -m "feat(auth): persist refresh tokens in DB with atomic rotation"
```

---

## Task 5: Verify against live Mongo (e2e)

**Files:** none (verification only).

- [ ] **Step 1: Bring up the test Mongo (if not already running)**

Run: `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d mongo-test`
Expected: `mongo-test` container reports healthy. If you prefer `npm run docker:test`, skip steps 2–3 and let docker-compose run the full suite inside the container.

- [ ] **Step 2: Export `TEST_MONGODB_URI` for local jest**

Check `docker-compose.test.yml` for the published port. Typical value:

```bash
export TEST_MONGODB_URI="mongodb://localhost:27018/nuebics_test"
```

- [ ] **Step 3: Run the auth happy suite**

Run: `npm run test:e2e -- --testPathPatterns="auth/happy"`
Expected: all tests pass, including the new `AUTH-HAPPY-003b`.

- [ ] **Step 4: Run the full auth + verification e2e suite to catch regressions**

Run: `npm run test:e2e -- --testPathPatterns="auth|verification"`
Expected: all tests pass. In particular:
- `AUTH-HAPPY-002` (login) — still green; the extra DB write is invisible to the response.
- `AUTH-HAPPY-003` (refresh) — still green; same wire shape.
- `AUTH-HAPPY-003b` (rotation invalidates old) — now green.
- `AUTH-CHAOS-*` and negative suites — unaffected.

- [ ] **Step 5: (optional) Run the live smoke script**

Run: `bash scripts/auth-smoke.sh`
Expected: T16 continues to pass (refresh produces a fresh JWT with `user_details`). T18 (access token in refresh slot → 401) continues to pass because signature verification still runs first.

- [ ] **Step 6: Inspect the Mongo collection manually (spot check)**

Run: `docker exec nuebics-mongo-test mongosh --quiet nuebics_test --eval 'db.refresh_tokens.find({}, {sessionId:1, tokenHash:1, expiresAt:1}).toArray()'`
Expected: one row per active session, `tokenHash` is a 64-char hex string, `expiresAt` ≈ now + 5 days. After running `AUTH-HAPPY-003b`, the row's `tokenHash` should differ from `sha256(original refresh_token)`.

No commit needed in this task.

---

## Task 6: Final sweep — commit anything outstanding

**Files:** none expected; this is a safety net.

- [ ] **Step 1: Check git status**

Run: `git status`
Expected: clean tree. If there are uncommitted changes from prior tasks (e.g. prettier re-ran on touched files), stage + commit them:

```bash
git add -u
git commit -m "chore(auth): formatting cleanup after refresh-token DB work"
```

- [ ] **Step 2: Review the final diff against `master`**

Run: `git log --oneline master..HEAD` and `git diff --stat master..HEAD`
Expected: 4–5 small commits, diff limited to the files listed in "File Structure" above. No changes under `src/auth/dto/`, no changes to controllers beyond what the previous plan already landed.

---

## Rollback plan

If something goes sideways in production after deploy:
- Revert the `AuthService` commit from Task 4 — `login()` and `refresh()` fall back to pure-JWT behavior; the `refresh_tokens` collection becomes dormant.
- The schema and module wiring from Tasks 1–2 can stay; they're inert without the service code that writes to them.
- No data migration required for rollback — existing JWT refresh tokens still verify fine.
