import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers, userA, createFile } from '../helpers/seed';
import { loginUser, authed } from '../helpers/auth';
import {
  PAYLOAD_PATH_TRAVERSAL,
  PAYLOAD_SQLI_CLASSIC,
  PAYLOAD_XSS_SCRIPT,
  deepNested
} from '../helpers/malicious';

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

describe('Files — Chaos', () => {
  it('FILE-CHAOS-001: path-traversal in filename → sanitized key or 400', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session).post('/api/files/upload').send({
      fileName: PAYLOAD_PATH_TRAVERSAL,
      fileType: 'text/plain',
      fileSize: 10
    });
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.key).not.toContain('..');
    }
  });

  it('FILE-CHAOS-002: SQLi in :id param → 400 Invalid file ID', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .patch(`/api/files/files/${encodeURIComponent(PAYLOAD_SQLI_CLASSIC)}`)
      .send({ name: 'x' })
      .expect(400);
    expect(res.body.error).toBe('Invalid file ID');
  });

  it('FILE-CHAOS-003: XSS in file name behavior documented', async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: 'base.txt' });
    const res = await authed(app, session)
      .patch(`/api/files/files/${id}`)
      .send({ name: PAYLOAD_XSS_SCRIPT.slice(0, 40) });
    expect([200, 400]).toContain(res.status);
  });

  it('FILE-CHAOS-004: deepNested body → 4xx, not 500', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/upload')
      .send(deepNested(1000));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
