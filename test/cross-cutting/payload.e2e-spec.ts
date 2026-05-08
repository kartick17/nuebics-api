import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers } from '../helpers/seed';
import { PAYLOAD_MALFORMED_JSON, deepNested } from '../helpers/malicious';

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

describe('Cross-cutting — Payload matrix', () => {
  it('§6.4-PL-02: deepNested 500 → 4xx, never 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send(deepNested(500));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('§6.4-PL-03: text/plain on JSON endpoint → 4xx', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('{"identifier":"a","password":"b"}');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('§6.4-PL-04: malformed JSON → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(PAYLOAD_MALFORMED_JSON);
    expect(res.status).toBe(400);
  });

  it('§6.4-PL-05: empty body on POST requiring one → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send();
    expect(res.status).toBe(400);
  });
});
