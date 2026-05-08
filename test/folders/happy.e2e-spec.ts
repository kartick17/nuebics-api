import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock } from '../helpers/s3-mock';
import { seedUsers, userA, createFolder } from '../helpers/seed';
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

describe('Folders — Happy', () => {
  it('FLD-HAPPY-001: POST /files/folders creates root folder', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/folders')
      .send({ name: 'Docs', parentId: null })
      .expect(201);
    expect(res.body.folder).toMatchObject({ name: 'Docs', status: 'active' });
  });

  it('FLD-HAPPY-002: nested folder create', async () => {
    const session = await loginUser(app, userA);
    const parent = await createFolder(app, session, 'Parent');
    const res = await authed(app, session)
      .post('/api/files/folders')
      .send({ name: 'Child', parentId: parent })
      .expect(201);
    expect(res.body.folder.parentId).toBe(parent);
  });

  it('FLD-HAPPY-003: GET /files/folders lists root', async () => {
    const session = await loginUser(app, userA);
    await createFolder(app, session, 'A');
    await createFolder(app, session, 'B');
    const res = await authed(app, session)
      .get('/api/files/folders')
      .expect(200);
    expect(res.body.folders).toHaveLength(2);
  });

  it('FLD-HAPPY-004: GET /files/folders/:id returns folder + breadcrumbs', async () => {
    const session = await loginUser(app, userA);
    const parent = await createFolder(app, session, 'Parent');
    const child = await createFolder(app, session, 'Child', parent);
    const res = await authed(app, session)
      .get(`/api/files/folders/${child}`)
      .expect(200);
    expect(res.body.breadcrumbs.length).toBeGreaterThanOrEqual(1);
  });

  it('FLD-HAPPY-005: PATCH rename folder', async () => {
    const session = await loginUser(app, userA);
    const id = await createFolder(app, session, 'Old');
    const res = await authed(app, session)
      .patch(`/api/files/folders/${id}`)
      .send({ name: 'New' })
      .expect(200);
    expect(res.body.folder.name).toBe('New');
  });

  it('FLD-HAPPY-006: PATCH move folder', async () => {
    const session = await loginUser(app, userA);
    const a = await createFolder(app, session, 'A');
    const b = await createFolder(app, session, 'B');
    const res = await authed(app, session)
      .patch(`/api/files/folders/${b}`)
      .send({ parentId: a })
      .expect(200);
    expect(res.body.folder.parentId).toBe(a);
  });

  it('FLD-HAPPY-007: DELETE folder moves to trash', async () => {
    const session = await loginUser(app, userA);
    const id = await createFolder(app, session, 'Gone');
    const res = await authed(app, session)
      .del(`/api/files/folders/${id}`)
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  it('FLD-HAPPY-008: toggle favourite', async () => {
    const session = await loginUser(app, userA);
    const id = await createFolder(app, session, 'Fav');
    const res = await authed(app, session)
      .patch(`/api/files/folders/${id}/favourite`)
      .send({ isFavourite: true })
      .expect(200);
    expect(res.body.folder.isFavourite).toBe(true);
  });
});
