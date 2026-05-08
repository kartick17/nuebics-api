import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import {
  seedUsers,
  userA,
  userB,
  createFile,
  createFolder
} from '../helpers/seed';
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

describe('Cross-cutting — IDOR matrix', () => {
  it("§6.2-IDOR-01 file GET: other user's id → 403|404", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa);
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).get(`/api/files/download/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('§6.2-IDOR-02 file PATCH: → 403|404', async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa);
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb)
      .patch(`/api/files/files/${id}`)
      .send({ name: 'hijack' });
    expect([403, 404]).toContain(res.status);
  });

  it('§6.2-IDOR-03 file DELETE: → 403|404', async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa);
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).del(`/api/files/files/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('§6.2-IDOR-04 folder GET: → 403|404', async () => {
    const sa = await loginUser(app, userA);
    const id = await createFolder(app, sa, 'P');
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).get(`/api/files/folders/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('§6.2-IDOR-05 folder PATCH: → 403|404', async () => {
    const sa = await loginUser(app, userA);
    const id = await createFolder(app, sa, 'P');
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb)
      .patch(`/api/files/folders/${id}`)
      .send({ name: 'x' });
    expect([403, 404]).toContain(res.status);
  });

  it('§6.2-IDOR-06 folder DELETE: → 403|404', async () => {
    const sa = await loginUser(app, userA);
    const id = await createFolder(app, sa, 'P');
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).del(`/api/files/folders/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('§6.2-IDOR-07 trash restore: → 403|404', async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa);
    await authed(app, sa).del(`/api/files/files/${id}`);
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).post(
      `/api/files/trash/restore/${id}?type=file`
    );
    expect([403, 404]).toContain(res.status);
  });
});
