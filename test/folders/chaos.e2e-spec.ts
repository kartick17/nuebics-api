import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers, userA } from '../helpers/seed';
import { loginUser, authed } from '../helpers/auth';
import { PAYLOAD_XSS_SCRIPT, PAYLOAD_SQLI_CLASSIC } from '../helpers/malicious';

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

describe('Folders — Chaos', () => {
  it('FLD-CHAOS-001: SQLi in :id → 400 Invalid folder ID', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .get(`/api/files/folders/${encodeURIComponent(PAYLOAD_SQLI_CLASSIC)}`)
      .expect(400);
    expect(res.body.error).toBe('Invalid folder ID');
  });

  it('FLD-CHAOS-002: XSS in folder name — 400 (reserved-char rule) or 201 literal', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/folders')
      .send({ name: PAYLOAD_XSS_SCRIPT });
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.folder.name).toBe(PAYLOAD_XSS_SCRIPT);
    }
  });

  it('FLD-CHAOS-003: name over 255 chars → 400', async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post('/api/files/folders')
      .send({ name: 'x'.repeat(300) })
      .expect(400);
  });
});
