import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from '../helpers/app';
import { connectTestDb, truncateAll, disconnectTestDb } from '../helpers/db';
import { resetS3Mock, s3HeadMissing } from '../helpers/s3-mock';
import { seedUsers, userA, createFile } from '../helpers/seed';
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

describe('Files — Negative', () => {
  it('FILE-NEG-001: upload missing fields → 400', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/upload')
      .send({})
      .expect(400);
    expect(res.body.error).toBe('fileName, fileType and fileSize are required');
  });

  it('FILE-NEG-002: upload negative fileSize → 400', async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post('/api/files/upload')
      .send({ fileName: 'x.txt', fileType: 'text/plain', fileSize: -1 })
      .expect(400);
  });

  it('FILE-NEG-003: upload with non-existent folder → 404', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/upload')
      .send({
        fileName: 'x.txt',
        fileType: 'text/plain',
        fileSize: 10,
        folderId: '507f1f77bcf86cd799439011'
      })
      .expect(404);
    expect(res.body.error).toBe('Target folder not found');
  });

  it('FILE-NEG-004: upload with invalid folderId → 400', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/upload')
      .send({
        fileName: 'x.txt',
        fileType: 'text/plain',
        fileSize: 10,
        folderId: 'not-an-id'
      })
      .expect(400);
    expect(res.body.error).toBe('Invalid folderId');
  });

  it('FILE-NEG-005: confirm when S3 HEAD missing → 400', async () => {
    const session = await loginUser(app, userA);
    const up = await authed(app, session)
      .post('/api/files/upload')
      .send({ fileName: 'z.txt', fileType: 'text/plain', fileSize: 100 })
      .expect(201);
    s3HeadMissing();
    const res = await authed(app, session)
      .post('/api/files/confirm')
      .send({
        key: up.body.key,
        fileName: 'z.txt',
        fileType: 'text/plain',
        fileSize: 100
      })
      .expect(400);
    expect(res.body.error).toBe(
      'File not found in S3 — upload may have failed'
    );
  });

  it('FILE-NEG-006: PATCH nonexistent file → 404', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .patch('/api/files/files/507f1f77bcf86cd799439011')
      .send({ name: 'new.txt' })
      .expect(404);
    expect(res.body.error).toBe('File not found');
  });

  it('FILE-NEG-007: PATCH with no fields → 400', async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session);
    await authed(app, session)
      .patch(`/api/files/files/${id}`)
      .send({})
      .expect(400);
  });

  it('FILE-NEG-008: PATCH with invalid file id → 400', async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .patch('/api/files/files/not-a-uuid')
      .send({ name: 'x' })
      .expect(400);
  });

  it('FILE-NEG-009: PATCH name with reserved char → 400', async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session);
    await authed(app, session)
      .patch(`/api/files/files/${id}`)
      .send({ name: 'bad/name.txt' })
      .expect(400);
  });

  it('FILE-NEG-010: DELETE nonexistent → 404', async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .del('/api/files/files/507f1f77bcf86cd799439011')
      .expect(404);
  });

  it('FILE-NEG-011: favourite without body → 400', async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session);
    await authed(app, session)
      .patch(`/api/files/files/${id}/favourite`)
      .send({})
      .expect(400);
  });

  it('FILE-NEG-012: batch download empty → 400', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/download')
      .send({ fileIds: [], folderIds: [] })
      .expect(400);
    expect(res.body.error).toBe('Provide at least one fileId or folderId');
  });

  it('FILE-NEG-013: batch download with non-array fileIds → 400', async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post('/api/files/download')
      .send({ fileIds: 'not-an-array', folderIds: [] })
      .expect(400);
    expect(res.body.error).toBe('fileIds and folderIds must be arrays');
  });
});
