import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA } from "../helpers/seed";
import { oversizedBody } from "../helpers/malicious";

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

describe("Auth — Negative", () => {
  it("AUTH-NEG-001: empty signup body → 400", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/signup").send({}).expect(400);
    expect(res.body).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("AUTH-NEG-002: non-email email → 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({
        name: "X",
        email: "not-an-email",
        password: "Password123!",
        confirmPassword: "Password123!",
      })
      .expect(400);
    expect(res.body.ok).toBe(false);
  });

  it("AUTH-NEG-003: short password → 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({
        name: "X",
        email: "e@test.local",
        password: "abc",
        confirmPassword: "abc",
      })
      .expect(400);
    expect(res.body.ok).toBe(false);
  });

  it("AUTH-NEG-003b: confirmPassword mismatch → 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({
        name: "X",
        email: "e@test.local",
        password: "Password123!",
        confirmPassword: "Different456!",
      })
      .expect(400);
    expect(res.body.ok).toBe(false);
  });

  it("AUTH-NEG-003c: neither email nor phone → 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({ name: "X", password: "Password123!", confirmPassword: "Password123!" })
      .expect(400);
    expect(res.body.ok).toBe(false);
  });

  it("AUTH-NEG-005: duplicate email → 409", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({
        name: "Dup",
        email: userA.email,
        phone: "+15559998888",
        password: "Password123!",
        confirmPassword: "Password123!",
      })
      .expect(409);
    expect(res.body).toEqual({ ok: false, error: "Email is already in use" });
  });

  it("AUTH-NEG-005b: duplicate phone → 409", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send({
        name: "Dup",
        email: "other@test.local",
        phone: userA.phone,
        password: "Password123!",
        confirmPassword: "Password123!",
      })
      .expect(409);
    expect(res.body.error).toBe("Phone number is already in use");
  });

  it("AUTH-NEG-006: wrong password → 401 generic", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ identifier: userA.email, password: "wrong" })
      .expect(401);
    expect(res.body).toEqual({ ok: false, error: "Invalid credentials" });
  });

  it("AUTH-NEG-006b: unknown email → 401 same body (anti-enumeration)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ identifier: "nobody@test.local", password: "whatever" })
      .expect(401);
    expect(res.body).toEqual({ ok: false, error: "Invalid credentials" });
  });

  it("AUTH-NEG-007: GET /me without Authorization → 401", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/me").expect(401);
    expect(res.body).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("AUTH-NEG-010: oversized signup body → 413 or 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/signup")
      .send(oversizedBody(12));
    expect([400, 413]).toContain(res.status);
    expect(res.body.ok).toBe(false);
  });
});
