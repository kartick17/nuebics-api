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

describe("Files — Happy", () => {
  it("FILE-HAPPY-001: POST /files/upload returns presigned URL", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/files/upload")
      .send({ fileName: "a.txt", fileType: "text/plain", fileSize: 10, folderId: null })
      .expect(201);
    expect(res.body).toMatchObject({
      presignedUrl: expect.any(String),
      key: expect.stringContaining("uploads/"),
      folderId: null,
    });
  });

  it("FILE-HAPPY-002: POST /files/confirm creates DB record", async () => {
    const session = await loginUser(app, userA);
    const up = await authed(app, session)
      .post("/api/files/upload")
      .send({ fileName: "b.txt", fileType: "text/plain", fileSize: 100 })
      .expect(201);
    const res = await authed(app, session)
      .post("/api/files/confirm")
      .send({ key: up.body.key, fileName: "b.txt", fileType: "text/plain", fileSize: 100 })
      .expect(201);
    expect(res.body.file).toMatchObject({
      name: "b.txt",
      type: "text/plain",
      size: 100,
      status: "active",
      isFavourite: false,
    });
  });

  it("FILE-HAPPY-003: GET /files/files lists root files", async () => {
    const session = await loginUser(app, userA);
    await createFile(app, session, { name: "root.txt" });
    const res = await authed(app, session).get("/api/files/files").expect(200);
    expect(res.body.files.length).toBeGreaterThan(0);
    expect(res.body.files.find((f: any) => f.name === "root.txt")).toBeDefined();
  });

  it("FILE-HAPPY-004: GET /files/files?folderId scoped list", async () => {
    const session = await loginUser(app, userA);
    const folderId = await createFolder(app, session, "Docs");
    await createFile(app, session, { name: "in.txt", folderId });
    const res = await authed(app, session)
      .get(`/api/files/files?folderId=${folderId}`)
      .expect(200);
    expect(res.body.files).toHaveLength(1);
    expect(res.body.files[0].folderId).toBe(folderId);
  });

  it("FILE-HAPPY-005: PATCH /files/files/:id renames", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "old.txt" });
    const res = await authed(app, session)
      .patch(`/api/files/files/${id}`)
      .send({ name: "new.txt" })
      .expect(200);
    expect(res.body.file.name).toBe("new.txt");
  });

  it("FILE-HAPPY-006: DELETE /files/files/:id moves to trash", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "del.txt" });
    const res = await authed(app, session).del(`/api/files/files/${id}`).expect(200);
    expect(res.body).toEqual({ success: true, message: "del.txt moved to trash" });
  });

  it("FILE-HAPPY-007: PATCH /files/files/:id/favourite toggles flag", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "fav.txt" });
    const res = await authed(app, session)
      .patch(`/api/files/files/${id}/favourite`)
      .send({ isFavourite: true })
      .expect(200);
    expect(res.body.file.isFavourite).toBe(true);
  });

  it("FILE-HAPPY-008: GET /files/download/:id returns presigned URL", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "dl.txt" });
    const res = await authed(app, session).get(`/api/files/download/${id}`).expect(200);
    expect(res.body).toEqual({ url: expect.any(String) });
  });

  it("FILE-HAPPY-009: POST /files/download batch returns items", async () => {
    const session = await loginUser(app, userA);
    const id1 = await createFile(app, session, { name: "x.txt" });
    const id2 = await createFile(app, session, { name: "y.txt" });
    const res = await authed(app, session)
      .post("/api/files/download")
      .send({ fileIds: [id1, id2], folderIds: [] })
      .expect(201);
    expect(res.body.items).toHaveLength(2);
  });

  it("FILE-HAPPY-010: GET /files/contents returns folders+files+breadcrumbs", async () => {
    const session = await loginUser(app, userA);
    await createFolder(app, session, "Sub");
    await createFile(app, session, { name: "here.txt" });
    const res = await authed(app, session).get("/api/files/contents").expect(200);
    expect(res.body).toMatchObject({
      folders: expect.any(Array),
      files: expect.any(Array),
      breadcrumbs: expect.any(Array),
    });
  });
});
