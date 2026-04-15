import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA, userB, createFile } from "../helpers/seed";
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

describe("Files — Security", () => {
  it("FILE-SEC-001: no auth → 401 on every files endpoint", async () => {
    await request(app.getHttpServer()).get("/api/files/files").expect(401);
    await request(app.getHttpServer()).post("/api/files/upload").send({}).expect(401);
    await request(app.getHttpServer()).post("/api/files/confirm").send({}).expect(401);
    await request(app.getHttpServer()).get("/api/files/contents").expect(401);
  });

  it("FILE-SEC-002 (IDOR-read): userB cannot download userA's file", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa, { name: "priv.txt" });
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).get(`/api/files/download/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it("FILE-SEC-003 (IDOR-update): userB cannot PATCH userA's file", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa, { name: "priv.txt" });
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb)
      .patch(`/api/files/files/${id}`)
      .send({ name: "hijack.txt" });
    expect([403, 404]).toContain(res.status);
  });

  it("FILE-SEC-004 (IDOR-delete): userB cannot DELETE userA's file", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa, { name: "priv.txt" });
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).del(`/api/files/files/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it("FILE-SEC-005 (IDOR-fav): userB cannot favourite userA's file", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFile(app, sa);
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb)
      .patch(`/api/files/files/${id}/favourite`)
      .send({ isFavourite: true });
    expect([403, 404]).toContain(res.status);
  });

  it("FILE-SEC-006: GET /files/files does not leak other user's files", async () => {
    const sa = await loginUser(app, userA);
    await createFile(app, sa, { name: "a-private.txt" });
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).get("/api/files/files").expect(200);
    expect(res.body.files.find((f: any) => f.name === "a-private.txt")).toBeUndefined();
  });
});
