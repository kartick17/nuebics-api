# API Test Specification — Generic NestJS E2E

> **Version:** 1.0.0
> **Last updated:** 2026-04-14
> **Audience:** QA engineers, backend engineers, security reviewers implementing Jest + Supertest E2E suites against a NestJS API.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Global Test Fixtures & Helpers](#2-global-test-fixtures--helpers)
3. [Auth Module — Full Spec](#3-auth-module--full-spec)
4. [Users Module — Summary Spec](#4-users-module--summary-spec)
5. [Products Module — Summary Spec](#5-products-module--summary-spec)
6. [Cross-Cutting Scenarios](#6-cross-cutting-scenarios)
7. [Performance Budgets & SLA](#7-performance-budgets--sla)
8. [Coverage Checklist](#8-coverage-checklist)
9. [Appendix](#9-appendix)

---

## 1. Introduction

### 1.1 Purpose & Scope

This document is a QA-grade test specification for a generic NestJS API. It enumerates scenarios across five categories — **Happy Path**, **Negative / Edge**, **Security**, **Performance**, **Chaos** — for three representative modules (Auth, Users, Products) and a shared cross-cutting section that applies to every module.

The **Auth module is specified in full**. Users and Products are specified in **summary form** and defer to the cross-cutting section for patterns that repeat everywhere (auth bypass, IDOR, rate limiting, payload limits, input sanitization).

Each table row is written to be directly implementable as a single Jest `it(...)` case using Supertest. Where a row references a helper (e.g., `authedRequest(userA)`) or a payload constant (e.g., `PAYLOAD_SQLI_CLASSIC`), the definition lives in Section 2.

### 1.2 Tech Stack Assumptions

| Concern | Assumption |
|---|---|
| Framework | NestJS 10+ |
| Input validation | `class-validator` + `class-transformer` via global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` |
| Auth | Passport + `@nestjs/jwt` with `JwtAuthGuard` on protected routes |
| Rate limiting | `@nestjs/throttler` (per-IP by default, per-user where noted) |
| Persistence | ORM-agnostic (TypeORM or Prisma); scenarios are written against observable behavior, not ORM internals |
| Body parsing | Default Express adapter; `app.use(bodyParser.json({ limit: '10mb' }))` |
| Test harness | Jest 29+ with Supertest against `app.getHttpServer()`; a dedicated, truncated test DB per run |

### 1.3 Environment

```
API_BASE_URL=http://localhost:3000
NODE_ENV=test
DB_URL=<dedicated test DB>
JWT_ACCESS_TTL=900       # 15 minutes
JWT_REFRESH_TTL=604800   # 7 days
THROTTLER_TTL=60         # seconds
THROTTLER_LIMIT=10       # per IP per TTL
```

All tests must target the URL in `API_BASE_URL`. No scenario uses production credentials or external network calls.

### 1.4 Conventions

**Test-ID scheme:** `MODULE-CATEGORY-###` where `MODULE ∈ {AUTH, USR, PRD, XC}`, `CATEGORY ∈ {HAPPY, NEG, SEC, PERF, CHAOS}`, and `###` is a zero-padded integer unique within the (module, category) pair. Examples: `AUTH-HAPPY-001`, `XC-IDOR-03`.

**Category definitions:**

| Code | Meaning |
|---|---|
| HAPPY | Functional / happy path — well-formed request by an authorized caller. |
| NEG | Negative / edge — malformed, out-of-range, missing fields, or constraint violations. |
| SEC | Security — auth bypass, IDOR, rate limiting, enumeration, token abuse. |
| PERF | Performance & concurrency — latency budgets, race conditions, optimistic-lock failures. |
| CHAOS | Break-the-system — malformed JSON, oversized/deep payloads, injection strings, unicode. |

**Status-code legend used throughout:**

| Code | Used for |
|---|---|
| 200 | Successful GET/PATCH with body |
| 201 | Successful POST that created a resource |
| 204 | Successful DELETE / logout (no body) |
| 400 | `ValidationPipe` / `BadRequestException` |
| 401 | `JwtAuthGuard` / `UnauthorizedException` |
| 403 | `ForbiddenException` — authenticated but not authorized (IDOR, role) |
| 404 | Resource not found (non-leaky cases only; see §6.2 for 403-vs-404 policy) |
| 409 | `ConflictException` — unique constraint, stale version |
| 413 | `PayloadTooLargeException` — body over limit |
| 415 | Unsupported `Content-Type` |
| 422 | Semantic error when business rule rejects otherwise-valid input |
| 429 | `ThrottlerException` — rate limit exceeded |
| 500 | Must NEVER be seen in E2E tests; any 500 is an automatic failure |

**Assertion policy:** every row specifies both an expected status **and** an expected response shape. A passing test asserts both; asserting only status is insufficient.

---

## 2. Global Test Fixtures & Helpers

### 2.1 Seeded users

Every test run starts with these three users present in the test DB:

| Alias | Email | Password | Roles |
|---|---|---|---|
| `userA` | `a@test.local` | `Password123!` | `["user"]` |
| `userB` | `b@test.local` | `Password123!` | `["user"]` |
| `admin` | `admin@test.local` | `AdminPass123!` | `["user","admin"]` |

`userA` and `userB` exist so that IDOR scenarios have two distinct, peer-level identities. `admin` exercises role-gated routes.

### 2.2 Auth helpers

```ts
// test/helpers/auth.ts
export interface Tokens { accessToken: string; refreshToken: string }

export async function login(user: SeededUser): Promise<Tokens> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
  return { accessToken: res.body.accessToken, refreshToken: res.body.refreshToken };
}

export function authedRequest(app, tokens: Tokens) {
  const agent = request(app.getHttpServer());
  // returns a thin wrapper that attaches `Authorization: Bearer <access>` to every call
  return {
    get:   (url) => agent.get(url).set('Authorization', `Bearer ${tokens.accessToken}`),
    post:  (url) => agent.post(url).set('Authorization', `Bearer ${tokens.accessToken}`),
    patch: (url) => agent.patch(url).set('Authorization', `Bearer ${tokens.accessToken}`),
    del:   (url) => agent.delete(url).set('Authorization', `Bearer ${tokens.accessToken}`),
  };
}
```

### 2.3 DB reset strategy

- `beforeAll`: run migrations against the test DB, then seed users from §2.1.
- `beforeEach`: truncate all non-user tables (keep the seeded users to avoid re-login cost). Reset Throttler storage.
- `afterAll`: drop DB connection; no DB left around.

Scenarios that explicitly test Throttler must call `resetThrottler()` in `beforeEach` to avoid cross-test contamination.

### 2.4 Malicious payload library

Named constants that every table below references by name.

```ts
// test/helpers/malicious.ts
export const PAYLOAD_SQLI_CLASSIC    = "' OR 1=1 --";
export const PAYLOAD_SQLI_UNION      = "' UNION SELECT NULL,NULL,NULL--";
export const PAYLOAD_NOSQL_OPERATOR  = { $gt: "" };
export const PAYLOAD_XSS_SCRIPT      = `<script>alert(1)</script>`;
export const PAYLOAD_XSS_IMG         = `<img src=x onerror=alert(1)>`;
export const PAYLOAD_PATH_TRAVERSAL  = "../../../../etc/passwd";
export const PAYLOAD_CRLF_INJECTION  = "foo\r\nX-Injected: yes";
export const PAYLOAD_NULL_BYTE       = "abc\u0000def";
export const PAYLOAD_UNICODE_HOMO    = "а@test.local"; // Cyrillic 'а' not Latin 'a'
export const PAYLOAD_MALFORMED_JSON  = '{"email":'; // unterminated

export const oversizedBody = (mb: number) =>
  ({ blob: 'x'.repeat(mb * 1024 * 1024) });

export const deepNested = (depth: number) => {
  let obj: any = {};
  let cursor = obj;
  for (let i = 0; i < depth; i++) { cursor.n = {}; cursor = cursor.n; }
  return obj;
};
```

These names appear verbatim in every scenario table below so authors of the tests know exactly which constant to import.

---

## 3. Auth Module — Full Spec

### 3.1 Endpoint inventory

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | Rate-limited 10/60s per IP |
| POST | `/auth/login` | — | Rate-limited 10/60s per IP |
| POST | `/auth/refresh` | — (cookie or body) | Rotates refresh token on use |
| POST | `/auth/logout` | `JwtAuthGuard` | Revokes current session |
| GET  | `/auth/me` | `JwtAuthGuard` | Returns current user |
| POST | `/auth/forgot-password` | — | Always returns 202 (anti-enumeration) |
| POST | `/auth/reset-password` | — | Single-use token, 15-min TTL |

### 3.2 Happy Path

| Test ID | Endpoint | Preconditions | Request | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|---|
| AUTH-HAPPY-001 | POST `/auth/register` | fresh email | `{email:"new@test.local", password:"Password123!", name:"New User"}` | 201 | `{id: uuid, email:"new@test.local", createdAt: iso8601}`; MUST NOT contain `password` or `passwordHash` | Triggers `ValidationPipe` |
| AUTH-HAPPY-002 | POST `/auth/login` | userA exists | `{email:"a@test.local", password:"Password123!"}` | 200 | `{accessToken: jwt, refreshToken: jwt, expiresIn: 900, tokenType:"Bearer"}` | JWT `sub` equals userA id |
| AUTH-HAPPY-003 | POST `/auth/refresh` | valid refresh token | `{refreshToken: <r>}` | 200 | `{accessToken: jwt, refreshToken: jwt (new), expiresIn: 900}`; old refresh is now invalid | Rotation recorded |
| AUTH-HAPPY-004 | POST `/auth/logout` | logged in as userA | `authedRequest(userA).post('/auth/logout')` | 204 | empty body; subsequent `GET /auth/me` with same token → 401 | Session revoked |
| AUTH-HAPPY-005 | GET `/auth/me` | logged in as userA | `authedRequest(userA).get('/auth/me')` | 200 | `{id, email:"a@test.local", name, roles:["user"]}` | `JwtAuthGuard` attached userA |
| AUTH-HAPPY-006 | POST `/auth/forgot-password` | userA exists | `{email:"a@test.local"}` | 202 | `{message:"If the account exists, a reset link has been sent."}` | Same body for unknown email (see AUTH-SEC-006) |
| AUTH-HAPPY-007 | POST `/auth/reset-password` | valid token from 006 | `{token:<t>, newPassword:"Password456!"}` | 200 | `{message:"Password updated."}`; login with new password succeeds | Token single-use |

### 3.3 Negative / Validation

| Test ID | Endpoint | Request | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|
| AUTH-NEG-001 | POST `/auth/register` | `{}` | 400 | `{statusCode:400, message:[…IsEmail…, …IsNotEmpty…], error:"Bad Request"}` | `ValidationPipe` returns array of violations |
| AUTH-NEG-002 | POST `/auth/register` | `{email:123, password:"Password123!", name:"X"}` | 400 | message array contains `"email must be an email"` | `IsEmail` |
| AUTH-NEG-003 | POST `/auth/register` | `{email:"a@b.c", password:"abc", name:"X"}` | 400 | message array contains `"password must be longer than or equal to 8 characters"` | `MinLength(8)` |
| AUTH-NEG-004 | POST `/auth/register` | `{email:"a@b.c", password:"Password123!", name:"X", isAdmin:true}` | 400 | message contains `"property isAdmin should not exist"` | `forbidNonWhitelisted:true` |
| AUTH-NEG-005 | POST `/auth/register` | duplicate userA email | 409 | `{statusCode:409, message:"Email already registered", error:"Conflict"}` | DB unique constraint surfaced as `ConflictException` |
| AUTH-NEG-006 | POST `/auth/login` | wrong password | 401 | `{statusCode:401, message:"Invalid credentials", error:"Unauthorized"}` | Same body as unknown email (anti-enumeration) |
| AUTH-NEG-007 | GET `/auth/me` | no `Authorization` header | 401 | `{statusCode:401, message:"Unauthorized"}` | `JwtAuthGuard` |
| AUTH-NEG-008 | POST `/auth/reset-password` | expired token | 400 | `{statusCode:400, message:"TOKEN_EXPIRED"}` | Explicit machine-readable code |
| AUTH-NEG-009 | POST `/auth/reset-password` | token already used | 400 | `{statusCode:400, message:"TOKEN_CONSUMED"}` | Single-use enforcement |
| AUTH-NEG-010 | POST `/auth/register` | body = `oversizedBody(12)` | 413 | `{statusCode:413, message:"Payload Too Large"}` | Body limit 10mb |

### 3.4 Security & Vulnerability

| Test ID | Endpoint | Scenario | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|
| AUTH-SEC-001 | GET `/auth/me` | missing header | 401 | generic 401 body | See §6.1 auth-bypass matrix |
| AUTH-SEC-002 | GET `/auth/me` | header `Authorization: Bearer tampered.jwt.sig` | 401 | `{statusCode:401, message:"Unauthorized"}` | JWT signature verify fails |
| AUTH-SEC-003 | GET `/auth/me` | expired access token | 401 | body includes `"TOKEN_EXPIRED"` | Clock-skew window ≤ 30s |
| AUTH-SEC-004 | POST `/auth/refresh` | body contains an **access** token in `refreshToken` field | 401 | `{statusCode:401, message:"Invalid refresh token"}` | Token type discriminator enforced |
| AUTH-SEC-005 | POST `/auth/login` | 11 requests in 60s from same IP, 11th is still wrong password | 429 | `{statusCode:429, message:"ThrottlerException: Too Many Requests"}`; `Retry-After` header present | Throttler TTL=60, limit=10 (see §6.3) |
| AUTH-SEC-006 | POST `/auth/forgot-password` | unknown email | 202 | identical body to AUTH-HAPPY-006; response latency within 20ms of known-email latency | Anti-enumeration — body **and** timing |
| AUTH-SEC-007 | GET `/auth/me` | JWT forged with `alg:none` | 401 | `{statusCode:401}` | Server must reject `none` explicitly |
| AUTH-SEC-008 | GET `/auth/me` | JWT signed with HS256 using public RS256 key (key-confusion) | 401 | `{statusCode:401}` | JwtStrategy pins algorithm |
| AUTH-SEC-009 | POST `/auth/logout` + `/auth/me` | after logout, reuse old access token | 401 | `{statusCode:401}` | Revocation list / session flag honored |

### 3.5 Performance & Concurrency

| Test ID | Endpoint | Scenario | Assertion | Notes |
|---|---|---|---|---|
| AUTH-PERF-001 | POST `/auth/login` | 50 RPS for 30s (Autocannon or k6) | P95 < 200ms, 0 errors | See §7 |
| AUTH-PERF-002 | POST `/auth/refresh` | two parallel refresh calls with the **same** refresh token | exactly one 200, the other 401 with `TOKEN_REUSED`; both tokens invalidated | Refresh-token reuse detection |
| AUTH-PERF-003 | POST `/auth/register` | 100 concurrent requests with 100 unique emails | all 201; 100 distinct user rows in DB | No id collision, no deadlocks |
| AUTH-PERF-004 | POST `/auth/register` | 10 concurrent requests with the **same** new email | exactly one 201, nine 409 | Unique-constraint race |
| AUTH-PERF-005 | GET `/auth/me` | 200 RPS for 30s | P95 < 150ms | Cached user lookup |

### 3.6 Chaos / Break-the-system

| Test ID | Endpoint | Payload | Expected Status | Expected Response | Notes |
|---|---|---|---|---|---|
| AUTH-CHAOS-001 | POST `/auth/login` | raw body `PAYLOAD_MALFORMED_JSON` with `Content-Type: application/json` | 400 | `{statusCode:400, message:"Unexpected end of JSON input"}` or equivalent | Must not 500 |
| AUTH-CHAOS-002 | POST `/auth/login` | `{email: PAYLOAD_SQLI_CLASSIC, password:"x"}` | 400 | message array contains `"email must be an email"` | `IsEmail` catches; no DB error leaked |
| AUTH-CHAOS-003 | POST `/auth/register` | `{email:"c@test.local", password:"Password123!", name: PAYLOAD_XSS_SCRIPT}` | 201 | stored `name` is the literal string; response `Content-Type: application/json; charset=utf-8`; subsequent GET returns the same literal (no execution context) | Output-encoding contract |
| AUTH-CHAOS-004 | POST `/auth/register` | `{email:"d@test.local", password: PAYLOAD_NULL_BYTE, name:"X"}` | 400 | message contains `"password contains invalid characters"` | Sanitized before hash |
| AUTH-CHAOS-005 | POST `/auth/register` | body = `deepNested(10000)` | 400 or 413 | any 4xx, not 500 | Parser depth guard |
| AUTH-CHAOS-006 | POST `/auth/login` | `{email: PAYLOAD_NOSQL_OPERATOR, password:"x"}` | 400 | message contains `"email must be an email"` | Objects rejected by `IsEmail` |
| AUTH-CHAOS-007 | POST `/auth/register` | `{email: PAYLOAD_UNICODE_HOMO, password:"Password123!", name:"X"}` | 201 | resulting id is distinct from any Latin-a variant | Documented homoglyph behavior |
| AUTH-CHAOS-008 | POST `/auth/login` | `Content-Type: application/xml` body `<x/>` | 415 | `{statusCode:415, message:"Unsupported Media Type"}` | JSON-only |

---

## 4. Users Module — Summary Spec

### 4.1 Endpoint inventory

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET    | `/users/:id` | `JwtAuthGuard` | Self or admin |
| PATCH  | `/users/:id` | `JwtAuthGuard` | Self or admin; `whitelist:true` DTO |
| DELETE | `/users/:id` | `JwtAuthGuard` | Self or admin; soft-delete |
| GET    | `/users?query=&limit=&page=` | `JwtAuthGuard + RolesGuard('admin')` | Admin-only, paginated |

### 4.2 Consolidated scenario matrix

| Endpoint | HAPPY | NEG | SEC | PERF | CHAOS |
|---|---|---|---|---|---|
| GET `/users/:id` | `USR-HAPPY-001`: userA reads own → 200 `{id,email,name,roles}` | `USR-NEG-001`: `:id` not UUID → 400 (`ParseUUIDPipe`) | `USR-SEC-001`: userA reads userB's id → 403 `ForbiddenException` (see §6.2-IDOR-01) | `USR-PERF-001`: P95 < 150ms @ 200 RPS | `USR-CHAOS-001`: `:id = PAYLOAD_SQLI_CLASSIC` → 400 (§6.5-SAN-01) |
| PATCH `/users/:id` | `USR-HAPPY-002`: userA updates own `name` → 200 | `USR-NEG-002`: unknown field → 400 (`forbidNonWhitelisted`); `USR-NEG-003`: `email` duplicate → 409 | `USR-SEC-002`: userA patches userB → 403 (§6.2-IDOR-02); `USR-SEC-003`: non-admin attempts to set `roles` → 403 | `USR-PERF-002`: two concurrent PATCHes on same user → both 200, last-write-wins documented, no partial update | `USR-CHAOS-002`: `{name: PAYLOAD_XSS_SCRIPT}` → 200, stored literal, safe on read |
| DELETE `/users/:id` | `USR-HAPPY-003`: userA deletes own → 204; subsequent GET → 404 | `USR-NEG-004`: unknown id → 404; `USR-NEG-005`: already-deleted id → 404 (idempotent) | `USR-SEC-004`: userA deletes userB → 403 (§6.2-IDOR-03) | — | `USR-CHAOS-003`: double DELETE in flight → exactly one 204, one 404 |
| GET `/users?query=` | `USR-HAPPY-004`: admin lists → 200 `{items:[…], total, page, limit}` | `USR-NEG-006`: `limit=1000` → 400 (`@Max(100)`); `USR-NEG-007`: `page=-1` → 400 (`@Min(1)`) | `USR-SEC-005`: non-admin → 403 `RolesGuard` | `USR-PERF-003`: P95 < 400ms @ 100 RPS with 10k rows | `USR-CHAOS-004`: `query = PAYLOAD_SQLI_UNION` → 200 with zero matches, no DB error (§6.5-SAN-02) |

**Domain constraints (3-5 sentences).** Users are **soft-deleted**: `DELETE` sets `deletedAt` and all list/get endpoints filter it out. A soft-deleted user's email is NOT released — attempting to register the same email still returns 409 until a separate purge job removes the row. Role changes are admin-only and audited; attempting to escalate `roles` via `PATCH /users/:id` even on one's own record returns 403. Pagination is mandatory on list: `limit` is clamped via `@Max(100)`, default 20; `page` is 1-indexed via `@Min(1)`.

---

## 5. Products Module — Summary Spec

### 5.1 Endpoint inventory

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST   | `/products` | `JwtAuthGuard` | Authenticated users; `sku` unique |
| GET    | `/products` | — | Public, paginated, cacheable |
| GET    | `/products/:id` | — | Public |
| PATCH  | `/products/:id` | `JwtAuthGuard` | Owner or admin; optimistic locking via `version` |
| DELETE | `/products/:id` | `JwtAuthGuard + RolesGuard('admin')` | Admin-only |

### 5.2 Consolidated scenario matrix

| Endpoint | HAPPY | NEG | SEC | PERF | CHAOS |
|---|---|---|---|---|---|
| POST `/products` | `PRD-HAPPY-001`: `{sku:"SKU-1", name:"A", price:10}` → 201 `{id,sku,name,price,version:1,ownerId}` | `PRD-NEG-001`: `price: -1` → 400 (`@Min(0)`); `PRD-NEG-002`: missing `sku` → 400; `PRD-NEG-003`: duplicate `sku` → 409 | `PRD-SEC-001`: no auth → 401 (§6.1-AB-01) | `PRD-PERF-001`: bulk-create 1000 items in a transaction; mid-batch failure → full rollback, zero partial rows | `PRD-CHAOS-001`: `{price:"ten"}` → 400 (`IsNumber`) |
| GET `/products` | `PRD-HAPPY-002`: → 200 `{items, total, page, limit}` | `PRD-NEG-004`: `limit=0` → 400 (`@Min(1)`) | — | `PRD-PERF-002`: P95 < 400ms @ 100 RPS, 50k rows; N+1 check (§7) | `PRD-CHAOS-002`: `?sort=${PAYLOAD_SQLI_CLASSIC}` → 400, not 500 |
| GET `/products/:id` | `PRD-HAPPY-003`: existing id → 200 | `PRD-NEG-005`: unknown id → 404 (public resource, 404 is acceptable — no auth-leak concern) | — | `PRD-PERF-003`: P95 < 150ms @ 200 RPS | `PRD-CHAOS-003`: `:id = PAYLOAD_PATH_TRAVERSAL` → 400 (§6.5-SAN-03) |
| PATCH `/products/:id` | `PRD-HAPPY-004`: owner updates `price`, `version` increments → 200 | `PRD-NEG-006`: stale `version` in body → 409 `{code:"STALE_VERSION"}` | `PRD-SEC-002`: non-owner non-admin PATCH → 403 (§6.2-IDOR-04) | `PRD-PERF-004`: two concurrent PATCHes with same `version` → one 200, one 409 `StaleObjectException` | `PRD-CHAOS-004`: `{name: PAYLOAD_XSS_IMG}` → 200 stored literal; read returns literal |
| DELETE `/products/:id` | `PRD-HAPPY-005`: admin deletes → 204 | `PRD-NEG-007`: unknown id → 404 | `PRD-SEC-003`: non-admin user → 403 `RolesGuard` | — | `PRD-CHAOS-005`: `:id = "null"` string → 400 (`ParseUUIDPipe`) |

**Domain constraints.** `sku` is a globally unique business key enforced by a DB unique index; duplicate inserts surface as `ConflictException`. Every mutable product row carries an integer `version` column; `PATCH` requires the caller to echo back the `version` they read, and the service increments it atomically (`UPDATE … WHERE id=? AND version=?`) — mismatches return 409, never silent overwrite. `DELETE` is hard-delete for admins but is blocked by a FK constraint on `order_items` and surfaces as 409 `{code:"IN_USE"}` in that case. Public GET endpoints are cacheable; `Cache-Control: public, max-age=30` should be asserted on 200 responses.

---

## 6. Cross-Cutting Scenarios

This section is the single source of truth for scenarios that apply identically across every module. Module tables cite row IDs from here (e.g., `§6.2-IDOR-02`). Every protected endpoint in every module must have corresponding tests here applied.

### 6.1 Auth-bypass matrix

Applies to every route guarded by `JwtAuthGuard`. Each row must be executed against at least one representative protected endpoint per module (`/auth/me`, `/users/:id`, `/products` POST).

| ID | Condition | Request | Expected Status | Body |
|---|---|---|---|---|
| §6.1-AB-01 | No `Authorization` header | `GET /users/:id` | 401 | `{statusCode:401, message:"Unauthorized"}` |
| §6.1-AB-02 | Header present but not `Bearer` scheme | `Authorization: Basic dXNlcjpwYXNz` | 401 | same |
| §6.1-AB-03 | `Bearer` but token is the empty string | `Authorization: Bearer ` | 401 | same |
| §6.1-AB-04 | Tampered JWT signature (flip last byte) | any bearer call | 401 | same |
| §6.1-AB-05 | Expired JWT (`exp` < now) | any bearer call | 401 | body includes `"TOKEN_EXPIRED"` |
| §6.1-AB-06 | JWT with wrong `aud` claim | any bearer call | 401 | same |
| §6.1-AB-07 | Revoked JWT (after logout) | any bearer call | 401 | same |
| §6.1-AB-08 | JWT with `alg:none` | any bearer call | 401 | same |

### 6.2 IDOR matrix

For every `/<resource>/:id` route, login as `userA` and attempt `userB`'s id. **Policy: return 403, not 404**, for protected resources — 404 leaks the existence of the sibling record.

| ID | Route template | Attempt | Expected | Rationale |
|---|---|---|---|---|
| §6.2-IDOR-01 | GET `/users/:id` | userA reads userB | 403 `ForbiddenException` | Prevents user-enumeration via 403 vs 404 timing |
| §6.2-IDOR-02 | PATCH `/users/:id` | userA patches userB | 403 | Auth does not imply authorization |
| §6.2-IDOR-03 | DELETE `/users/:id` | userA deletes userB | 403 | — |
| §6.2-IDOR-04 | PATCH `/products/:id` | userA (non-owner) patches userB's product | 403 | Ownership check in service |
| §6.2-IDOR-05 | any `/<resource>/:id` | authenticated user supplies a syntactically valid but **non-existent** id | 404 | For public/non-sensitive resources only — contrast with 403 rule above |

**403-vs-404 rule:** for any resource scoped to a user (e.g., user profile, private document), return 403 when the id exists but belongs to someone else, AND also 403 when the id does not exist, so the attacker cannot distinguish. For public resources (products), 404 is fine.

### 6.3 Rate limiting (`@nestjs/throttler`) matrix

Config under test: `THROTTLER_TTL=60s`, `THROTTLER_LIMIT=10`, per-IP scope unless noted.

| ID | Route | Scope | Burst | Expected |
|---|---|---|---|---|
| §6.3-RL-01 | POST `/auth/login` | per IP | 11 in 60s | 11th → 429, `Retry-After` header, body `{statusCode:429, message:"ThrottlerException: Too Many Requests"}` |
| §6.3-RL-02 | POST `/auth/register` | per IP | 11 in 60s | 11th → 429 |
| §6.3-RL-03 | POST `/auth/forgot-password` | per (IP, email) | 4 in 60s for same email | 4th → 429; different email from same IP unaffected up to IP limit |
| §6.3-RL-04 | any authenticated endpoint | per user | 101 in 60s | 101st → 429 (if per-user throttler is configured); otherwise document absence |
| §6.3-RL-05 | header spoofing | — | send `X-Forwarded-For: 9.9.9.9` from blocked IP | STILL 429 if `trust proxy` is off; documented behavior either way |

The 429 body MUST always include `Retry-After` (seconds) so a well-behaved client can back off.

### 6.4 Payload-size / malformed-JSON matrix

| ID | Condition | Expected |
|---|---|---|
| §6.4-PL-01 | Body > 10 MB (`oversizedBody(12)`) | 413 `PayloadTooLargeException` |
| §6.4-PL-02 | `deepNested(10000)` | 400 or 413 (parser-dependent); never 500 |
| §6.4-PL-03 | `Content-Type: text/plain` with JSON body | 415 `Unsupported Media Type` |
| §6.4-PL-04 | `Content-Type: application/json` with `PAYLOAD_MALFORMED_JSON` | 400 `BadRequestException` |
| §6.4-PL-05 | Empty body on a POST that requires one | 400 (validation array) |
| §6.4-PL-06 | UTF-8 BOM prefix on JSON body | 200 / 201 (must parse successfully) |

### 6.5 Sanitization matrix (SQLi / XSS / NoSQL / traversal / CRLF)

| ID | Vector | Location | Expected |
|---|---|---|---|
| §6.5-SAN-01 | `PAYLOAD_SQLI_CLASSIC` | URL param `:id` | 400 from `ParseUUIDPipe`; zero DB contact |
| §6.5-SAN-02 | `PAYLOAD_SQLI_UNION` | query string `?query=` | 200 with no matching rows; **no** DB error in response, no 500 |
| §6.5-SAN-03 | `PAYLOAD_PATH_TRAVERSAL` | URL param / filename | 400; never resolves outside resource namespace |
| §6.5-SAN-04 | `PAYLOAD_NOSQL_OPERATOR` (`{$gt:""}`) | any body field typed as string | 400 (type mismatch) — must not reach query layer |
| §6.5-SAN-05 | `PAYLOAD_XSS_SCRIPT` | any string body field (e.g., `name`) | Stored literal; response `Content-Type: application/json; charset=utf-8`; literal round-trips unchanged on read |
| §6.5-SAN-06 | `PAYLOAD_CRLF_INJECTION` | any header-bound field or URL | 400; response MUST NOT contain `X-Injected` header |
| §6.5-SAN-07 | `PAYLOAD_NULL_BYTE` | password / token fields | 400 or sanitized before storage |

---

## 7. Performance Budgets & SLA

| Endpoint class | P50 | P95 | P99 | Target throughput | Example |
|---|---|---|---|---|---|
| Auth write | 100 ms | 200 ms | 400 ms | 50 RPS | `/auth/login`, `/auth/register` |
| Read-by-id | 50 ms | 150 ms | 300 ms | 200 RPS | `/auth/me`, `/users/:id`, `/products/:id` |
| List / search | 150 ms | 400 ms | 800 ms | 100 RPS | `/products`, `/users?query=` |
| Heavy join | 250 ms | 600 ms | 1200 ms | 30 RPS | reporting / admin endpoints |

**N+1 detection.** Every list endpoint must be run under a query-counting harness (TypeORM `logger: "advanced-console"` or Prisma `log: ['query']`). A page of N items must execute a **constant** number of queries — independent of N. Any growth with N is a failing test.

**Explain-plan requirement.** Any query observed above 100 ms in CI must have a committed `EXPLAIN ANALYZE` output alongside the code change, with an index justification.

**Cold vs warm methodology.** Latency budgets are asserted against **warm** caches (after a 5-request warm-up). Cold P95 is allowed to be 2× warm P95; anything worse indicates a missing warm-up path or a cache-stampede bug. Tests must explicitly label which regime they are asserting.

---

## 8. Coverage Checklist

This grid is the pull-request definition-of-done. A PR adding a new module must produce all 25 ticks for that module row plus the cross-cutting row.

```
                HAPPY  NEG  SEC  PERF  CHAOS
Auth             [ ]   [ ]  [ ]  [ ]   [ ]
Users            [ ]   [ ]  [ ]  [ ]   [ ]
Products         [ ]   [ ]  [ ]  [ ]   [ ]
Cross-cutting    [ ]   [ ]  [ ]  [ ]   [ ]
```

A category cell is ticked when every row in the corresponding table (§3.X, §4.2 column, §5.2 column, §6.X) has an implemented, passing Jest test referenced by its Test ID.

---

## 9. Appendix

### A. Sample Supertest snippets (one per category)

```ts
// HAPPY — AUTH-HAPPY-002
it('AUTH-HAPPY-002: logs in userA', async () => {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: 'a@test.local', password: 'Password123!' })
    .expect(200);
  expect(res.body).toMatchObject({
    accessToken: expect.any(String),
    refreshToken: expect.any(String),
    expiresIn: 900,
    tokenType: 'Bearer',
  });
});
```

```ts
// NEG — AUTH-NEG-003
it('AUTH-NEG-003: rejects short password', async () => {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email: 'e@test.local', password: 'abc', name: 'X' })
    .expect(400);
  expect(res.body.message).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/password.*longer than or equal to 8/i),
    ]),
  );
});
```

```ts
// SEC — §6.2-IDOR-02 via USR-SEC-002
it('USR-SEC-002: userA cannot patch userB', async () => {
  const tokens = await login(userA);
  const res = await authedRequest(app, tokens)
    .patch(`/users/${userB.id}`)
    .send({ name: 'hijack' })
    .expect(403);
  expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
});
```

```ts
// PERF — AUTH-PERF-002
it('AUTH-PERF-002: refresh-token reuse is detected', async () => {
  const { refreshToken } = await login(userA);
  const [a, b] = await Promise.allSettled([
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }),
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }),
  ]);
  const statuses = [a, b]
    .map(r => r.status === 'fulfilled' ? r.value.status : 500)
    .sort();
  expect(statuses).toEqual([200, 401]);
});
```

```ts
// CHAOS — AUTH-CHAOS-003
it('AUTH-CHAOS-003: XSS in name is stored as literal', async () => {
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      email: 'xss@test.local',
      password: 'Password123!',
      name: PAYLOAD_XSS_SCRIPT,
    })
    .expect(201);
  expect(reg.headers['content-type']).toMatch(/application\/json/);
  expect(reg.body.name).toBe(PAYLOAD_XSS_SCRIPT);
  // Round-trip: value unchanged on read
  const tokens = await login({ email: 'xss@test.local', password: 'Password123!' });
  const me = await authedRequest(app, tokens).get('/auth/me').expect(200);
  expect(me.body.name).toBe(PAYLOAD_XSS_SCRIPT);
});
```

### B. Response-shape schema conventions

- Use `toMatchObject` for partial matches when the response has optional or environment-dependent fields (`createdAt`, `id`).
- Use `expect.any(String)` for opaque tokens, `expect.stringMatching(/^[0-9a-f-]{36}$/i)` for UUIDs, `expect.any(Number)` for durations.
- Wrap repeated shapes behind a small helper:

```ts
export const tokenShape = () => ({
  accessToken: expect.any(String),
  refreshToken: expect.any(String),
  expiresIn: expect.any(Number),
  tokenType: 'Bearer',
});
```

- For error responses, always assert the full `{ statusCode, message, error }` triple rather than just `statusCode` — it catches cases where the server returns the right status but a leaky or inconsistent body.

### C. Glossary

| Term | Definition |
|---|---|
| **IDOR** | Insecure Direct Object Reference — accessing another user's resource by guessing/swapping its id. |
| **BOLA** | Broken Object Level Authorization — OWASP API1 name for the same class of bug as IDOR. |
| **DTO** | Data Transfer Object — a plain class annotated with `class-validator` decorators that NestJS validates before the controller runs. |
| **Pipe** | A NestJS interceptor that transforms or validates an argument before it reaches the controller (e.g., `ValidationPipe`, `ParseUUIDPipe`). |
| **Guard** | A NestJS component that decides whether a request is allowed to reach the handler (e.g., `JwtAuthGuard`, `RolesGuard`). |
| **Interceptor** | A NestJS component that wraps the handler to transform the response, measure latency, or inject cross-cutting logic. |
| **Throttler** | `@nestjs/throttler` — the rate-limiting module enforced per-IP or per-user. |
| **Optimistic locking** | Concurrency control where each row has a `version`; updates succeed only if the caller's `version` still matches the stored one. |
| **Anti-enumeration** | Designing responses (body and timing) so an attacker cannot tell whether a resource (user, email, token) exists. |
| **N+1 query** | Anti-pattern where fetching N parent rows triggers N extra child queries instead of one joined query. |
