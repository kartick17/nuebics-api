import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA } from "../helpers/seed";
import { loginUser, authed } from "../helpers/auth";
import { forgeAlgNone, forgeExpiredAccess, tamperSignature } from "../helpers/jwt-forge";

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

describe("Auth — Security", () => {
  it("AUTH-SEC-001: no header → 401", async () => {
    await request(app.getHttpServer()).get("/api/auth/me").expect(401);
  });

  it("AUTH-SEC-002: tampered JWT signature → 401", async () => {
    const session = await loginUser(app, userA);
    const bad = tamperSignature(session.bearer);
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${bad}`)
      .expect(401);
  });

  it("AUTH-SEC-003: expired access token → 401", async () => {
    const expired = await forgeExpiredAccess("507f1f77bcf86cd799439011");
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);
  });

  it("AUTH-SEC-004: access token in refresh slot → 401", async () => {
    const session = await loginUser(app, userA);
    const res = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", [`refresh_token=${encodeURIComponent(session.bearer)}`])
      .expect(401);
    expect(res.body.ok).toBe(false);
  });

  it("AUTH-SEC-005: login rate-limited after 10 attempts → 429", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ identifier: userA.email, password: "wrong" });
    }
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ identifier: userA.email, password: "wrong" });
    expect(res.status).toBe(429);
  });

  it("AUTH-SEC-007: alg:none forged JWT → 401", async () => {
    const forged = await forgeAlgNone("507f1f77bcf86cd799439011");
    await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${forged}`)
      .expect(401);
  });

  it("AUTH-SEC-009: access token reused after logout → 401 (finding if passes as 200)", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session).post("/api/auth/logout").expect(200);
    const res = await authed(app, session).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});
