# File & Folder Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/search` so a signed-in user can search their own files and folders by name (case-insensitive substring), returning two separately paginated lists.

**Architecture:** A new `SearchModule` at `src/search/` owns the endpoint. The service injects the `File` and `Folder` Mongoose models directly (via `MongooseModule.forFeature`) and runs four queries in parallel — `countDocuments` + `find` for each collection. The query string is regex-escaped before being compiled, so user input cannot inject regex metacharacters.

**Tech Stack:** NestJS 11, Mongoose, zod, Jest (`@nestjs/testing`), `JwtAuthGuard` for auth.

**Spec:** `docs/superpowers/specs/2026-05-23-file-folder-search-design.md`

---

## File Structure

| Path                                    | Action | Responsibility                                            |
| --------------------------------------- | ------ | --------------------------------------------------------- |
| `src/search/dto/search.schema.ts`       | Create | Zod schema + `SearchInput` type for query params          |
| `src/search/search.service.ts`          | Create | Build filter, escape regex, run parallel Mongo queries    |
| `src/search/search.controller.ts`       | Create | `GET /api/search`, parse query with zod, call service     |
| `src/search/search.module.ts`           | Create | Register controller + service + Mongoose `File`/`Folder`  |
| `src/search/search.service.spec.ts`     | Create | Unit tests with mocked Mongoose models                    |
| `src/app.module.ts`                     | Modify | Add `SearchModule` to `imports`                           |

Total: 5 new files, 1 modified file.

---

## Task 1: Zod schema for `GET /api/search` query params

**Files:**
- Create: `src/search/dto/search.schema.ts`

- [ ] **Step 1: Create the zod schema file**

File: `src/search/dto/search.schema.ts`

```ts
import { z } from 'zod';

export const searchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, 'q must be at least 2 characters')
    .max(100, 'q must be at most 100 characters'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  includeTrashed: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true')
    .default(false)
});

export type SearchInput = z.infer<typeof searchSchema>;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/search/dto/search.schema.ts
git commit -m "feat(search): add zod schema for search query params"
```

---

## Task 2: SearchService — write the failing tests first

**Files:**
- Create: `src/search/search.service.spec.ts`

The service does not exist yet, so the spec file imports it and the build will fail until Task 3 creates it. That is intentional (TDD red).

- [ ] **Step 1: Write the spec file**

File: `src/search/search.service.spec.ts`

```ts
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { SearchService } from './search.service';
import { File } from '../shared/database/schemas/file.schema';
import { Folder } from '../shared/database/schemas/folder.schema';
import { validateEnv } from '../config/env.validation';

type FindCall = {
  filter: any;
  sort?: any;
  skip?: number;
  limit?: number;
};

function makeModelMock(rows: any[], total: number) {
  const calls: FindCall[] = [];
  const countCalls: any[] = [];
  return {
    calls,
    countCalls,
    countDocuments: (filter: any) => {
      countCalls.push(filter);
      return { exec: async () => total };
    },
    find: (filter: any) => {
      const call: FindCall = { filter };
      calls.push(call);
      const chain = {
        sort(sort: any) {
          call.sort = sort;
          return chain;
        },
        skip(n: number) {
          call.skip = n;
          return chain;
        },
        limit(n: number) {
          call.limit = n;
          return chain;
        },
        lean: async () => rows
      };
      return chain;
    }
  };
}

describe('SearchService', () => {
  beforeAll(() => {
    process.env.CRYPTO_SECRET ||= 'a'.repeat(64);
    process.env.JWT_ACCESS_SECRET ||= 'b'.repeat(64);
    process.env.JWT_REFRESH_SECRET ||= 'c'.repeat(64);
    process.env.MONGODB_URI ||= 'mongodb://localhost/test';
    process.env.AWS_ACCESS_KEY_ID ||= 'x';
    process.env.AWS_SECRET_ACCESS_KEY ||= 'x';
    process.env.AWS_REGION ||= 'x';
    process.env.AWS_S3_BUCKET_NAME ||= 'x';
    process.env.ZOHO_CLIENT_ID ||= 'x';
    process.env.ZOHO_CLIENT_SECRET ||= 'x';
    process.env.ZOHO_REFRESH_TOKEN ||= 'x';
    process.env.ZOHO_PROJECT_ID ||= 'x';
    process.env.ZOHO_PROJECT_KEY ||= 'x';
    process.env.ZOHO_ENVIRONMENT ||= 'Development';
    process.env.ZOHO_BUCKET_NAME ||= 'x';
    process.env.CRON_SECRET ||= 'x';
  });

  async function buildService(
    fileMock: ReturnType<typeof makeModelMock>,
    folderMock: ReturnType<typeof makeModelMock>
  ) {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })
      ],
      providers: [
        SearchService,
        { provide: getModelToken(File.name), useValue: fileMock },
        { provide: getModelToken(Folder.name), useValue: folderMock }
      ]
    }).compile();
    return mod.get(SearchService);
  }

  it('runs a case-insensitive substring search scoped to userId, active by default', async () => {
    const files = makeModelMock([{ name: 'Annual report.pdf' }], 1);
    const folders = makeModelMock([{ name: 'Reports' }], 1);
    const service = await buildService(files, folders);

    const result = await service.search('u1', {
      q: 'report',
      page: 1,
      limit: 20,
      includeTrashed: false
    });

    expect(files.calls[0].filter.userId).toBe('u1');
    expect(files.calls[0].filter.status).toBe('active');
    expect(files.calls[0].filter.name.$options).toBe('i');
    expect(files.calls[0].filter.name.$regex).toBe('report');
    expect(folders.calls[0].filter.status).toBe('active');

    expect(result.query).toBe('report');
    expect(result.files.items).toEqual([{ name: 'Annual report.pdf' }]);
    expect(result.files.total).toBe(1);
    expect(result.folders.items).toEqual([{ name: 'Reports' }]);
    expect(result.folders.total).toBe(1);
  });

  it('escapes regex metacharacters in q', async () => {
    const files = makeModelMock([], 0);
    const folders = makeModelMock([], 0);
    const service = await buildService(files, folders);

    await service.search('u1', {
      q: 'file.pdf+v1(beta)',
      page: 1,
      limit: 20,
      includeTrashed: false
    });

    expect(files.calls[0].filter.name.$regex).toBe(
      'file\\.pdf\\+v1\\(beta\\)'
    );
  });

  it('drops the status filter when includeTrashed=true', async () => {
    const files = makeModelMock([], 0);
    const folders = makeModelMock([], 0);
    const service = await buildService(files, folders);

    await service.search('u1', {
      q: 'foo',
      page: 1,
      limit: 20,
      includeTrashed: true
    });

    expect(files.calls[0].filter.status).toBeUndefined();
    expect(folders.calls[0].filter.status).toBeUndefined();
  });

  it('applies pagination: skip = (page - 1) * limit, limit, sort updatedAt desc', async () => {
    const files = makeModelMock([], 0);
    const folders = makeModelMock([], 0);
    const service = await buildService(files, folders);

    await service.search('u1', {
      q: 'foo',
      page: 3,
      limit: 10,
      includeTrashed: false
    });

    expect(files.calls[0].skip).toBe(20);
    expect(files.calls[0].limit).toBe(10);
    expect(files.calls[0].sort).toEqual({ updatedAt: -1 });
    expect(folders.calls[0].skip).toBe(20);
    expect(folders.calls[0].limit).toBe(10);
    expect(folders.calls[0].sort).toEqual({ updatedAt: -1 });
  });

  it('returns empty arrays and zero totals when nothing matches', async () => {
    const files = makeModelMock([], 0);
    const folders = makeModelMock([], 0);
    const service = await buildService(files, folders);

    const result = await service.search('u1', {
      q: 'zzz',
      page: 1,
      limit: 20,
      includeTrashed: false
    });

    expect(result.files).toEqual({ items: [], page: 1, limit: 20, total: 0 });
    expect(result.folders).toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0
    });
  });
});
```

- [ ] **Step 2: Run the tests, expect a compile failure**

Run: `npx jest src/search/search.service.spec.ts`
Expected: FAIL — `Cannot find module './search.service'` (TS compile error). This is the "red" of TDD.

---

## Task 3: SearchService — minimal implementation

**Files:**
- Create: `src/search/search.service.ts`

- [ ] **Step 1: Write the service**

File: `src/search/search.service.ts`

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { File, FileDocument } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderDocument
} from '../shared/database/schemas/folder.schema';
import type { SearchInput } from './dto/search.schema';

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>
  ) {}

  async search(userId: string, input: SearchInput) {
    const { q, page, limit, includeTrashed } = input;
    const escaped = escapeRegex(q);
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      userId,
      name: { $regex: escaped, $options: 'i' }
    };
    if (!includeTrashed) {
      filter.status = 'active';
    }

    const [fileTotal, fileItems, folderTotal, folderItems] = await Promise.all([
      this.fileModel.countDocuments(filter).exec(),
      this.fileModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.folderModel.countDocuments(filter).exec(),
      this.folderModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return {
      query: q,
      files: { items: fileItems, page, limit, total: fileTotal },
      folders: { items: folderItems, page, limit, total: folderTotal }
    } as const;
  }
}
```

- [ ] **Step 2: Run the tests and confirm they pass**

Run: `npx jest src/search/search.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add src/search/search.service.ts src/search/search.service.spec.ts
git commit -m "feat(search): add SearchService with substring match across files & folders"
```

---

## Task 4: SearchController

**Files:**
- Create: `src/search/search.controller.ts`

- [ ] **Step 1: Write the controller**

File: `src/search/search.controller.ts`

```ts
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { TokenPayload } from '../shared/crypto/crypto.service';
import { SearchService } from './search.service';
import { searchSchema } from './dto/search.schema';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  // GET /api/search?q=...&page=...&limit=...&includeTrashed=...
  @Get()
  async search(
    @CurrentUser() auth: TokenPayload,
    @Query() query: Record<string, unknown>
  ) {
    const parsed = searchSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }

    return this.searchService.search(auth.userId, parsed.data);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/search/search.controller.ts
git commit -m "feat(search): add SearchController for GET /api/search"
```

---

## Task 5: SearchModule + wire into AppModule

**Files:**
- Create: `src/search/search.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write the module**

File: `src/search/search.module.ts`

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { File, FileSchema } from '../shared/database/schemas/file.schema';
import {
  Folder,
  FolderSchema
} from '../shared/database/schemas/folder.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: File.name, schema: FileSchema },
      { name: Folder.name, schema: FolderSchema }
    ])
  ],
  controllers: [SearchController],
  providers: [SearchService]
})
export class SearchModule {}
```

- [ ] **Step 2: Register in `AppModule`**

Modify `src/app.module.ts`:

Add import (alphabetically near other module imports):

```ts
import { SearchModule } from './search/search.module';
```

Add `SearchModule` to the `imports` array — place it after `FavouritesModule`, before `CronModule`:

```ts
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv
    }),
    DatabaseModule,
    HealthModule,
    CryptoModule,
    StratusModule,
    throttlerConfig,
    AuthModule,
    FoldersModule,
    FilesModule,
    TrashModule,
    FavouritesModule,
    SearchModule,
    CronModule
  ],
```

- [ ] **Step 3: Build the project to confirm DI graph compiles**

Run: `npx nest build`
Expected: exits 0; `dist/search/search.module.js` exists.

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: PASS. No regressions in existing specs (`folders.helpers.spec.ts`, `app.controller.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/search/search.module.ts src/app.module.ts
git commit -m "feat(search): wire SearchModule into AppModule"
```

---

## Task 6: Smoke test against a running server

Manual smoke test using the existing dev script. This proves the wiring (route + auth + Mongoose) end-to-end.

- [ ] **Step 1: Start the API in the background**

Run: `yarn start:dev` (background process; expect "API listening on :3001").
If `MONGODB_URI` is not reachable, the smoke test cannot proceed — surface that and stop.

- [ ] **Step 2: Verify 401 when no token is supplied**

Run:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3001/api/search?q=hi'
```

Expected: `401`.

- [ ] **Step 3: Verify 400 when `q` is too short**

Use an existing auth flow to mint a token (see Postman collection in `docs/NueVault.postman_collection.json` for the login route), then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3001/api/search?q=a'
```

Expected: `400` (zod error: "q must be at least 2 characters").

- [ ] **Step 4: Verify 200 with valid query**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3001/api/search?q=ab' | jq .
```

Expected: `{ "query": "ab", "files": { "items": [...], "page": 1, "limit": 20, "total": N }, "folders": { ... } }` shape with HTTP 200.

- [ ] **Step 5: Stop the dev server**

Kill the background process.

- [ ] **Step 6: Record any issues found**

If the smoke test surfaces a bug, file it as a fix task and re-run from Step 1.

---

## Self-Review Checklist

**Spec coverage:**

- Endpoint `GET /api/search` + auth — Task 4 (controller), Task 5 (wiring).
- Query params (`q`, `page`, `limit`, `includeTrashed`) with validation — Task 1.
- Response shape (`query`, `files: { items, page, limit, total }`, `folders: { ... }`) — Task 3.
- Substring + case-insensitive + regex escape — Task 3 (`escapeRegex`), Task 2 (test).
- Pagination math — Task 3, Task 2 (test).
- `userId` isolation — Task 3 (filter), Task 2 (test).
- `includeTrashed` toggling `status: 'active'` — Task 3, Task 2 (test).
- Sort by `updatedAt` desc — Task 3, Task 2 (test).
- Module wiring into `AppModule` — Task 5.
- Unit test file with the cases listed in the spec — Task 2.
- Smoke test — Task 6.

No spec sections are unaddressed.

**Type consistency:** `SearchInput` is defined in Task 1, imported in Task 3. Response field names (`query`, `files`, `folders`, `items`, `page`, `limit`, `total`) are identical across Tasks 2, 3, and the spec.

**Placeholders:** None — every step shows the exact code or exact command.
