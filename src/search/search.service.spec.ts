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
