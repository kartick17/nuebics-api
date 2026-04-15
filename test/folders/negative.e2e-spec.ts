import { INestApplication } from "@nestjs/common";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA, createFolder } from "../helpers/seed";
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

describe("Folders — Negative", () => {
  it("FLD-NEG-001: create folder empty name → 400", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session).post("/api/files/folders").send({ name: "" }).expect(400);
  });

  it("FLD-NEG-002: create folder with reserved chars → 400", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post("/api/files/folders")
      .send({ name: "bad/name" })
      .expect(400);
  });

  it("FLD-NEG-003: create nested folder with invalid parentId → 400", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post("/api/files/folders")
      .send({ name: "X", parentId: "not-an-id" })
      .expect(400);
  });

  it("FLD-NEG-004: create nested with non-existent parent → 404", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post("/api/files/folders")
      .send({ name: "X", parentId: "507f1f77bcf86cd799439011" })
      .expect(404);
  });

  it("FLD-NEG-005: duplicate sibling name → 409", async () => {
    const session = await loginUser(app, userA);
    await createFolder(app, session, "Dup");
    const res = await authed(app, session)
      .post("/api/files/folders")
      .send({ name: "Dup" })
      .expect(409);
    expect(res.body.error).toBe("A folder with this name already exists here");
  });

  it("FLD-NEG-006: move folder into itself → 400", async () => {
    const session = await loginUser(app, userA);
    const id = await createFolder(app, session, "Self");
    const res = await authed(app, session)
      .patch(`/api/files/folders/${id}`)
      .send({ parentId: id })
      .expect(400);
    expect(res.body.error).toBe("Cannot move a folder into itself");
  });

  it("FLD-NEG-007: move folder into its own descendant → 400", async () => {
    const session = await loginUser(app, userA);
    const parent = await createFolder(app, session, "P");
    const child = await createFolder(app, session, "C", parent);
    const res = await authed(app, session)
      .patch(`/api/files/folders/${parent}`)
      .send({ parentId: child })
      .expect(400);
    expect(res.body.error).toBe("Cannot move a folder into one of its subfolders");
  });

  it("FLD-NEG-008: rename to existing sibling name → 409", async () => {
    const session = await loginUser(app, userA);
    await createFolder(app, session, "A");
    const b = await createFolder(app, session, "B");
    const res = await authed(app, session)
      .patch(`/api/files/folders/${b}`)
      .send({ name: "A" })
      .expect(409);
    expect(res.body.error).toBe("A folder with this name already exists here");
  });

  it("FLD-NEG-009: PATCH non-existent folder → 404", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .patch("/api/files/folders/507f1f77bcf86cd799439011")
      .send({ name: "x" })
      .expect(404);
  });

  it("FLD-NEG-010: DELETE non-existent folder → 404", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session).del("/api/files/folders/507f1f77bcf86cd799439011").expect(404);
  });

  it("FLD-NEG-011: GET folder with invalid id → 400", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session).get("/api/files/folders/not-an-id").expect(400);
  });
});
