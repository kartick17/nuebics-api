import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers, userA, userB, createFile } from '../helpers/seed';
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

describe('Favourites — Security', () => {
  it('FAV-SEC-001: no auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/files/favourites').expect(401);
    await request(app.getHttpServer())
      .patch('/api/files/favourites/bulk')
      .send({ fileIds: [], folderIds: [], isFavourite: true })
      .expect(401);
  });

  it("FAV-SEC-002: userB bulk toggle on userA's ids → 0 updates or 403", async () => {
    const sa = await loginUser(app, userA);
    const aFile = await createFile(app, sa, { name: 'a.txt' });
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb)
      .patch('/api/files/favourites/bulk')
      .send({ fileIds: [aFile], folderIds: [], isFavourite: true });
    if (res.status === 200) {
      expect(res.body.updated.files).toBe(0);
    } else {
      expect([403, 404]).toContain(res.status);
    }
  });
});
