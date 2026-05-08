import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers } from '../helpers/seed';
import {
  PAYLOAD_MALFORMED_JSON,
  PAYLOAD_SQLI_CLASSIC,
  PAYLOAD_XSS_SCRIPT,
  PAYLOAD_NULL_BYTE,
  PAYLOAD_NOSQL_OPERATOR,
  PAYLOAD_UNICODE_HOMO,
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

describe('Auth — Chaos', () => {
  it('AUTH-CHAOS-001: malformed JSON body → 400, never 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(PAYLOAD_MALFORMED_JSON);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('AUTH-CHAOS-002: SQLi in identifier → 401 (invalid credentials)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: PAYLOAD_SQLI_CLASSIC, password: 'x' });
    expect([400, 401]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });

  it('AUTH-CHAOS-003: XSS in name stored as literal', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        name: PAYLOAD_XSS_SCRIPT.slice(0, 60),
        email: 'xss@test.local',
        phone: '+15551112222',
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
      .expect(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'xss@test.local', password: 'Password123!' })
      .expect(200);
    const accessToken = login.body.access_token;
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.user_details.name).toBe(PAYLOAD_XSS_SCRIPT.slice(0, 60));
  });

  it('AUTH-CHAOS-004: null-byte in password (documented behavior)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        name: 'NB',
        email: 'nb@test.local',
        phone: '+15551113333',
        password: `Password123!${PAYLOAD_NULL_BYTE}`,
        confirmPassword: `Password123!${PAYLOAD_NULL_BYTE}`
      });
    expect([201, 400]).toContain(res.status);
  });

  it('AUTH-CHAOS-005: deepNested body → 4xx, not 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send(deepNested(1000));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('AUTH-CHAOS-006: NoSQL operator in identifier → 4xx, never 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: PAYLOAD_NOSQL_OPERATOR, password: 'x' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.ok).toBe(false);
  });

  it('AUTH-CHAOS-007: unicode homoglyph email behavior documented', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        name: 'Homo',
        email: PAYLOAD_UNICODE_HOMO,
        phone: '+15551114444',
        password: 'Password123!',
        confirmPassword: 'Password123!'
      });
    expect([201, 400]).toContain(res.status);
  });

  it('AUTH-CHAOS-008: XML content-type → 4xx', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/xml')
      .send('<x/>');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
