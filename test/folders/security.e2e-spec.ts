import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA, userB, createFolder } from "../helpers/seed";
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

describe("Folders — Security", () => {
  it("FLD-SEC-001: no auth → 401 on every folders route", async () => {
    await request(app.getHttpServer()).get("/api/files/folders").expect(401);
    await request(app.getHttpServer())
      .post("/api/files/folders")
      .send({ name: "X" })
      .expect(401);
  });

  it("FLD-SEC-002 (IDOR-read): userB cannot read userA's folder", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFolder(app, sa, "Private");
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).get(`/api/files/folders/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it("FLD-SEC-003 (IDOR-update): userB cannot rename userA's folder", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFolder(app, sa, "Private");
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb)
      .patch(`/api/files/folders/${id}`)
      .send({ name: "Hijack" });
    expect([403, 404]).toContain(res.status);
  });

  it("FLD-SEC-004 (IDOR-delete): userB cannot delete userA's folder", async () => {
    const sa = await loginUser(app, userA);
    const id = await createFolder(app, sa, "Private");
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).del(`/api/files/folders/${id}`);
    expect([403, 404]).toContain(res.status);
  });

  it("FLD-SEC-005: userB list doesn't see userA's folders", async () => {
    const sa = await loginUser(app, userA);
    await createFolder(app, sa, "A-Secret");
    const sb = await loginUser(app, userB);
    const res = await authed(app, sb).get("/api/files/folders").expect(200);
    expect(res.body.folders.find((f: any) => f.name === "A-Secret")).toBeUndefined();
  });
});
