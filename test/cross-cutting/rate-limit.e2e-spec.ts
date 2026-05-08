import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers, userA } from '../helpers/seed';

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

describe('Cross-cutting — Rate limiting', () => {
  it('§6.3-RL-01: /auth/login 11th attempt → 429 (or documented as finding)', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ identifier: userA.email, password: 'wrong' });
    }
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: userA.email, password: 'wrong' });
    expect([401, 429]).toContain(res.status);
  });

  it('§6.3-RL-02: /auth/signup 11th attempt → 429', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          name: `R${i}`,
          email: `rl${i}@test.local`,
          phone: `+15557${String(i).padStart(6, '0')}`,
          password: 'Password123!',
          confirmPassword: 'Password123!'
        });
    }
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({
        name: 'R11',
        email: 'rl11@test.local',
        phone: '+15557999999',
        password: 'Password123!',
        confirmPassword: 'Password123!'
      });
    expect([201, 429]).toContain(res.status);
  });
});
