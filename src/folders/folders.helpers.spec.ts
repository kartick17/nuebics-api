import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { FoldersHelpers } from './folders.helpers';
import { File } from '../shared/database/schemas/file.schema';
import { Folder } from '../shared/database/schemas/folder.schema';
import { StratusService } from '../shared/stratus/stratus.service';
import { validateEnv } from '../config/env.validation';

describe('FoldersHelpers.isDescendantOf', () => {
  let helpers: FoldersHelpers;

  // Tree: A is root, B is child of A, C is child of B.
  //   A → B → C
  const subtreeQueries: Record<string, { _id: string }[]> = {
    A: [{ _id: 'B' }],
    B: [{ _id: 'C' }],
    C: []
  };

  const folderModelMock = {
    find: (filter: any) => {
      const parent = filter.parentId;
      return { lean: async () => subtreeQueries[parent] ?? [] };
    }
  };

  beforeAll(async () => {
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

    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })
      ],
      providers: [
        FoldersHelpers,
        { provide: getModelToken(File.name), useValue: {} },
        { provide: getModelToken(Folder.name), useValue: folderModelMock },
        {
          provide: StratusService,
          useValue: { deleteMany: async () => undefined }
        }
      ]
    }).compile();

    helpers = mod.get(FoldersHelpers);
  });

  it('returns true when target IS a descendant', async () => {
    await expect(helpers.isDescendantOf('C', 'A', 'u')).resolves.toBe(true);
    await expect(helpers.isDescendantOf('B', 'A', 'u')).resolves.toBe(true);
  });

  it('returns false when target is NOT a descendant', async () => {
    await expect(helpers.isDescendantOf('A', 'C', 'u')).resolves.toBe(false);
    await expect(helpers.isDescendantOf('X', 'A', 'u')).resolves.toBe(false);
  });

  it('returns true when target === ancestor (self)', async () => {
    await expect(helpers.isDescendantOf('A', 'A', 'u')).resolves.toBe(true);
  });
});
