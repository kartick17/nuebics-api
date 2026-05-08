import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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

describe('Verification — Negative', () => {
  it('VER-NEG-001: verify-email with wrong code → 400', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/auth/verify-email')
      .send({ code: '000000' })
      .expect(400);
    expect(res.body).toEqual({
      ok: false,
      error: 'Invalid verification code.'
    });
  });

  it('VER-NEG-002: verify-email empty code → 400 validation', async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post('/api/auth/verify-email')
      .send({ code: '' })
      .expect(400);
  });

  it('VER-NEG-003: verify-email without auth → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ code: '123456' })
      .expect(401);
    expect(res.body.ok).toBe(false);
  });

  it('VER-NEG-004: resend-otp invalid channel → 400', async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post('/api/auth/resend-otp')
      .send({ channel: 'fax' })
      .expect(400);
  });

  // VER-NEG-005 (phone-only account) skipped: signup schema makes email required.

  it('VER-NEG-006: resend-otp rate-limited after 3 per-user → 429', async () => {
    const session = await loginUser(app, userA);
    for (let i = 0; i < 3; i++) {
      await authed(app, session)
        .post('/api/auth/resend-otp')
        .send({ channel: 'email' });
    }
    const res = await authed(app, session)
      .post('/api/auth/resend-otp')
      .send({ channel: 'email' });
    expect(res.status).toBe(429);
  });
});
