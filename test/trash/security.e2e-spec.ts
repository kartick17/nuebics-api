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

describe('Trash — Security', () => {
  it('TRS-SEC-001: no auth → 401', async () => {
    await request(app.getHttpServer()).get('/api/files/trash').expect(401);
    await request(app.getHttpServer())
      .post('/api/files/trash/restore/507f1f77bcf86cd799439011?type=file')
      .expect(401);
  });

  it('TRS-SEC-002: userA trashed file not visible to userB', async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa, { name: 'priv.txt' });
    await authed(app, sa).del(`/api/files/files/${id}`);
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).get('/api/files/trash').expect(200);
    expect(res.body.files).toHaveLength(0);
  });

  it("TRS-SEC-003: userB cannot restore userA's trashed file", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa, { name: 'priv.txt' });
    await authed(app, sa).del(`/api/files/files/${id}`);
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).post(
      `/api/files/trash/restore/${id}?type=file`
    );
    expect([403, 404]).toContain(res.status);
  });
});
