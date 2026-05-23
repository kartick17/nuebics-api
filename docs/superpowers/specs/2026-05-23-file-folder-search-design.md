# File & folder search — design

**Status:** Approved for planning
**Date:** 2026-05-23
**Owner:** kartick17

## Goal

Add a search endpoint that lets a signed-in user find their files and folders by name from a single search box. Files and folders come back as two separate lists in one response, each paginated.

## Non-goals

- No full-text search of file contents.
- No fuzzy matching, ranking, or "best match first" scoring.
- No search across other users' data.
- No new database indexes beyond the ones that already exist on `files` and `folders` (see "Indexes" below).
- No changes to existing files/folders endpoints, schemas, or DTOs.

## Background

The codebase has two domain modules:

- `src/files/` — `FilesService` lists files with `find({ userId, folderId, status: 'active' }).sort({ updatedAt: -1 })`.
- `src/folders/` — folders share the same `userId`, `name`, `status`, and `updatedAt` shape.

The `File` and `Folder` Mongoose schemas (`src/shared/database/schemas/`) both have `userId` indexed and a compound index `{ userId, parentId|folderId, status }`. Names are not indexed today; queries will scan the per-user slice and run a regex against `name`, which is acceptable at the per-user data scale.

There is no search functionality yet. Users today can only list files inside a single folder.

## Approach

Add a new `SearchModule` at `src/search/`. It owns its own controller (`GET /api/search`), service, and DTO. The service injects both the `File` and `Folder` Mongoose models and runs the two queries in parallel (`Promise.all`).

A new module (rather than adding an endpoint to `FilesController`) keeps responsibilities clean: search returns both files and folders, so it doesn't belong inside `files/`. It also leaves room to grow (filters by type, date, etc.) without touching existing modules.

### Why substring regex (not Atlas Search)

The user's Mongo deployment is self-hosted (`@nestjs/mongoose` with a connection string), so `$search` / `$text` with Atlas Search is not available. A case-insensitive regex on a per-user filter is simple, correct, and fast enough for the expected scale (a user's own files and folders, not the global set). The regex pattern is escaped before being compiled, so users cannot send a pathological pattern (ReDoS-safe).

## API contract

**Endpoint:** `GET /api/search`
**Auth:** `JwtAuthGuard` (consistent with `FilesController`)

### Query params

| Param            | Type    | Required | Default | Rules                                |
| ---------------- | ------- | -------- | ------- | ------------------------------------ |
| `q`              | string  | yes      | —       | trimmed; min 2 chars; max 100 chars  |
| `page`           | int     | no       | `1`     | min 1                                |
| `limit`          | int     | no       | `20`    | min 1; max 100                       |
| `includeTrashed` | boolean | no       | `false` | accepts `"true"`/`"false"` (strings) |

Validation lives in a zod schema in `src/search/dto/search.schema.ts`. The controller calls `schema.safeParse(req.query)` and throws `BadRequestException(parsed.error.issues[0].message)` on failure (same pattern as `FilesController.upload`).

### Response — 200 OK

```json
{
  "query": "report",
  "files": {
    "items": [
      /* file documents, lean, sorted by updatedAt desc */
    ],
    "page": 1,
    "limit": 20,
    "total": 47
  },
  "folders": {
    "items": [
      /* folder documents, lean, sorted by updatedAt desc */
    ],
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

Both lists share the same `page` and `limit` (one shared pagination, applied to each list separately). `total` is the count of matches in that list for the current filter, ignoring `page`/`limit`.

### Errors

- `400 Bad Request` — missing `q`, `q` too short / too long, or invalid `page` / `limit` / `includeTrashed`.
- `401 Unauthorized` — handled by `JwtAuthGuard`.

## Module structure

```
src/search/
  search.module.ts        # imports MongooseModule.forFeature([File, Folder])
  search.controller.ts    # GET /api/search
  search.service.ts       # search(userId, parsedQuery)
  dto/
    search.schema.ts      # zod schema for query params
```

`SearchModule` is added to `AppModule.imports`. It does not re-register `FilesModule` or `FoldersModule` because it only needs the Mongoose models — those are registered locally via `MongooseModule.forFeature(...)`, matching how `FilesModule` already registers `File` and `Folder`.

## Data flow

1. Client sends `GET /api/search?q=report&page=1&limit=20&includeTrashed=false` with JWT.
2. `JwtAuthGuard` validates the token and attaches `TokenPayload` to the request.
3. `SearchController.search(auth, query)`:
   - Runs `searchSchema.safeParse(query)`. On failure → `BadRequestException`.
   - Calls `searchService.search(auth.userId, parsedQuery)`.
4. `SearchService.search(userId, { q, page, limit, includeTrashed })`:
   - Escapes regex metacharacters in `q` (see "Regex escape" below).
   - Builds a base filter: `{ userId, name: { $regex: escapedQ, $options: 'i' } }`.
   - If `includeTrashed` is `false`, adds `status: 'active'`.
   - Computes `skip = (page - 1) * limit`.
   - Runs four queries in parallel via `Promise.all`:
     - `fileModel.countDocuments(filter)`
     - `fileModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean()`
     - `folderModel.countDocuments(filter)`
     - `folderModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean()`
   - Returns the response shape above.
5. Controller returns the result.

## Regex escape

Substring search compiles the user query into a regex. Without escaping, a query like `a.b+c(d` is a valid (and potentially expensive) regex pattern. The service runs the query through a small helper:

```ts
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

This is applied once before building the filter. The escape helper lives inline in `search.service.ts` (a single-use helper does not need its own file).

## Indexes

The existing indexes already cover the filter shape:

- `files`: `{ userId: 1 }`, `{ userId: 1, folderId: 1, status: 1 }`
- `folders`: `{ userId: 1 }`, `{ userId: 1, parentId: 1, status: 1 }`

Mongo will use `userId` as the prefix and run the regex against `name` inside the per-user slice. We are **not** adding a `name` index because:

- A B-tree index on `name` only helps anchored prefix regexes (`/^foo/`), not the unanchored case-insensitive regex this design uses.
- A text index would change the matching semantics (whole-word, stemming) away from substring.

If search becomes slow at scale, the follow-up is a text index or Atlas Search, not a btree index on `name`.

## Error handling

Same pattern as the rest of the codebase:

- Zod validation failure → `BadRequestException` with `parsed.error.issues[0].message`.
- Mongo errors bubble to Nest's default exception filter.
- The service does not use the `{ error, status }` discriminated-result pattern from `FilesService` because there are no domain-level error states to surface — validation runs in the controller, and a successful query with zero matches is a valid `200` response with empty arrays.

## Testing

Unit test file: `src/search/search.service.spec.ts`. Same style as `src/folders/folders.helpers.spec.ts` — `@nestjs/testing` `Test.createTestingModule` with mocked Mongoose models (`getModelToken(File.name)`, `getModelToken(Folder.name)`).

Cases:

1. Substring match — `q = "report"` returns files/folders whose names contain `"report"`.
2. Case-insensitive — `q = "REPORT"` matches `"Annual report.pdf"`.
3. Regex escape — `q = "file.pdf"` matches the literal string, not "filexpdf".
4. `includeTrashed=false` — filter includes `status: 'active'`.
5. `includeTrashed=true` — filter omits the `status` constraint.
6. Pagination — `page=2, limit=10` produces `skip=10, limit=10`.
7. Empty results — returns `{ items: [], total: 0 }` for both lists, with the requested `page`/`limit`.
8. `userId` isolation — filter always includes the requesting user's `userId` (no cross-user leakage).

The controller is thin and is exercised by the service tests; a controller test is not added in this round.

## Out of scope (deferred)

- Sort by best-match relevance.
- Filter by file type, size range, or date range.
- Searching inside the current folder only (Q3 picked global; the param can be added later).
- Combined ranked list across files and folders.
- Fuzzy / typo-tolerant search.
