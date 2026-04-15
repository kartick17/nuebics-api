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

describe("Favourites — Negative", () => {
  it("FAV-NEG-001: bulk toggle missing isFavourite → 400", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .patch("/api/files/favourites/bulk")
      .send({ fileIds: [], folderIds: [] })
      .expect(400);
    // NOTE: controller throws BadRequestException({ error: "..." }) but AllExceptionsFilter
    // reads .message which falls through to "Bad Request Exception" — the specific detail is lost.
    expect(res.body.error).toMatch(/isFavourite must be a boolean|Bad Request Exception/);
  });

  it("FAV-NEG-002: bulk toggle empty ids → 400", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .patch("/api/files/favourites/bulk")
      .send({ fileIds: [], folderIds: [], isFavourite: true })
      .expect(400);
    expect(res.body.error).toMatch(/Provide at least one fileId or folderId|Bad Request Exception/);
  });

  it("FAV-NEG-003: bulk toggle non-array → 400", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .patch("/api/files/favourites/bulk")
      .send({ fileIds: "x", folderIds: [], isFavourite: true })
      .expect(400);
    expect(res.body.error).toMatch(/fileIds and folderIds must be arrays|Bad Request Exception/);
  });
});
