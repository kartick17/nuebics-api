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

describe("Favourites — Happy", () => {
  it("FAV-HAPPY-001: list when empty → {files:[], folders:[]}", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session).get("/api/files/favourites").expect(200);
    expect(res.body).toEqual({ files: [], folders: [] });
  });

  it("FAV-HAPPY-002: list after toggling one file favourite", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session);
    await authed(app, session)
      .patch(`/api/files/files/${id}/favourite`)
      .send({ isFavourite: true })
      .expect(200);
    const res = await authed(app, session).get("/api/files/favourites").expect(200);
    expect(res.body.files).toHaveLength(1);
  });

  it("FAV-HAPPY-003: bulk toggle favourites", async () => {
    const session = await loginUser(app, userA);
    const f1 = await createFile(app, session, { name: "f1.txt" });
    const f2 = await createFile(app, session, { name: "f2.txt" });
    const fo = await createFolder(app, session, "F");
    const res = await authed(app, session)
      .patch("/api/files/favourites/bulk")
      .send({ fileIds: [f1, f2], folderIds: [fo], isFavourite: true })
      .expect(200);
    expect(res.body.updated).toEqual({ files: 2, folders: 1 });
  });
});
