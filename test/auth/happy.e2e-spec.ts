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

describe('Auth — Happy', () => {
  it('AUTH-HAPPY-001: POST /api/auth/signup creates account', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        name: 'New User',
        email: 'new@test.local',
        phone: '+15550009999',
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
      .expect(201);
    expect(res.body).toEqual({
      ok: true,
      message: 'Account created successfully'
    });
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('AUTH-HAPPY-002: POST /api/auth/login returns tokens in body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: userA.email, password: userA.password })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('Logged in successfully');
    expect(res.body.access_token).toMatch(/^ey/);
    expect(res.body.refresh_token).toMatch(/^ey/);
    expect(res.body.user_details).toMatchObject({
      id: expect.any(String),
      name: userA.name,
      email: userA.email,
      phone: userA.phone,
      isEmailVerified: false,
      isPhoneVerified: false,
      vaultCredentialVerifier: false
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('AUTH-HAPPY-002b: login accepts phone as identifier', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: userA.phone, password: userA.password })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('AUTH-HAPPY-003: POST /api/auth/refresh returns new tokens in body', async () => {
    const session = await loginUser(app, userA);
    await new Promise((r) => setTimeout(r, 1100)); // ensure iat advances ≥ 1 s
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: session.refresh })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toBe('Token refreshed');
    expect(res.body.access_token).toMatch(/^ey/);
    expect(res.body.refresh_token).toMatch(/^ey/);
    expect(res.body.access_token).not.toBe(session.bearer);
    expect(res.body.refresh_token).not.toBe(session.refresh);
    expect(res.body.user_details).toMatchObject({
      id: expect.any(String),
      name: userA.name,
      email: userA.email,
      phone: userA.phone,
      isEmailVerified: false,
      isPhoneVerified: false,
      vaultCredentialVerifier: false
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('AUTH-HAPPY-003b: old refresh token is rejected after rotation', async () => {
    const session = await loginUser(app, userA);
    await new Promise((r) => setTimeout(r, 1100));

    // First rotation succeeds.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: session.refresh })
      .expect(200);

    // Re-using the original (now rotated-out) refresh token must fail.
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refresh_token: session.refresh })
      .expect(401);
    expect(res.body.ok).toBe(false);
  });

  it('AUTH-HAPPY-004: POST /api/auth/logout is removed (stateless API)', async () => {
    const session = await loginUser(app, userA);
    await authed(app, session).post('/api/auth/logout').expect(404);
  });

  it('AUTH-HAPPY-005: GET /api/auth/me returns authenticated user', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session).get('/api/auth/me').expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      user_details: {
        id: expect.any(String),
        name: userA.name,
        email: userA.email,
        phone: userA.phone,
        isEmailVerified: false,
        isPhoneVerified: false,
        vaultCredentialVerifier: false
      }
    });
  });
});
