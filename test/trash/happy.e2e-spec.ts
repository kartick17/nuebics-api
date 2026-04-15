import { INestApplication } from "@nestjs/common";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA, createFile, createFolder } from "../helpers/seed";
import { loginUser, authed } from "../helpers/auth";

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

describe("Trash — Happy", () => {
  it("TRS-HAPPY-001: GET /files/trash empty list", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session).get("/api/files/trash").expect(200);
    expect(res.body).toMatchObject({
      folders: [],
      files: [],
      retentionDays: expect.any(Number),
    });
  });

  it("TRS-HAPPY-002: trashed file appears in trash", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "del.txt" });
    await authed(app, session).del(`/api/files/files/${id}`).expect(200);
    const res = await authed(app, session).get("/api/files/trash").expect(200);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0]).toMatchObject({ name: "del.txt", status: "trashed" });
  });

  it("TRS-HAPPY-003: restore file", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "r.txt" });
    await authed(app, session).del(`/api/files/files/${id}`);
    const res = await authed(app, session)
      .post(`/api/files/trash/restore/${id}?type=file`)
      .expect(201);
    expect(res.body).toMatchObject({
      success: true,
      message: expect.stringContaining("restored"),
    });
  });

  it("TRS-HAPPY-004: restore folder", async () => {
    const session = await loginUser(app, userA);
    const id = await createFolder(app, session, "F");
    await authed(app, session).del(`/api/files/folders/${id}`);
    await authed(app, session)
      .post(`/api/files/trash/restore/${id}?type=folder`)
      .expect(201);
  });
});
