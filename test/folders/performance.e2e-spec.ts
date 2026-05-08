import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers, userA } from '../helpers/seed';
import { loginUser, authed } from '../helpers/auth';

let app: INestApplication;

beforeAll(async () => {
  await connectTestDb();
  app = await createTestApp();
});
beforeEach(async () => {
  await truncateAll();
  resetS3Mock();
  await seedUsers(app);
});
afterAll(async () => {
  await closeTestApp(app);
  await disconnectTestDb();
});

describe('Folders — Performance (concurrency)', () => {
  it('FLD-PERF-001: 5 concurrent creates with same sibling name → exactly one 201', async () => {
    const session = await loginUser(app, userA);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        authed(app, session)
          .post('/api/files/folders')
          .send({ name: 'Race', parentId: null })
      )
    );
    const statuses = results
      .filter((r) => r.status === 'fulfilled')
      .map((r: any) => r.value.status);
    const created = statuses.filter((s) => s === 201).length;
    expect(created).toBe(1);
    expect(statuses.every((s) => s !== 200)).toBe(true);
  });
});
