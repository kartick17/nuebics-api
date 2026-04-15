import { INestApplication } from "@nestjs/common";
import request from "supertest";
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

describe("VaultPassword — Negative", () => {
  it("VP-NEG-001: GET vault-password when not set → 404", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session).get("/api/auth/vault-password").expect(404);
    expect(res.body).toEqual({ ok: false, error: "No vault password set." });
  });

  it("VP-NEG-002: POST vault-password empty token → 400", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post("/api/auth/vault-password")
      .send({ encryptedToken: "" })
      .expect(400);
  });

  it("VP-NEG-003: GET vault-password without auth → 401", async () => {
    await request(app.getHttpServer()).get("/api/auth/vault-password").expect(401);
  });

  it("VP-NEG-004: POST vault-password without auth → 401", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/vault-password")
      .send({ encryptedToken: "x" })
      .expect(401);
  });
});
