import { INestApplication } from "@nestjs/common";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA } from "../helpers/seed";
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

describe("Trash — Negative", () => {
  it("TRS-NEG-001: restore missing type → 400", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/files/trash/restore/507f1f77bcf86cd799439011")
      .expect(400);
    expect(res.body.error).toMatch(/type must be file or folder|Bad Request Exception/);
  });

  it("TRS-NEG-002: restore invalid id → 400", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/files/trash/restore/not-an-id?type=file")
      .expect(400);
    expect(res.body.error).toMatch(/Invalid ID|Bad Request Exception/);
  });

  it("TRS-NEG-003: restore non-trashed item → 404", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/files/trash/restore/507f1f77bcf86cd799439011?type=file")
      .expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
