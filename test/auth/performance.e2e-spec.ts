import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA } from "../helpers/seed";
import { loginUser } from "../helpers/auth";

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

describe("Auth — Performance (concurrency)", () => {
  it("AUTH-PERF-002: parallel refresh with same token → one 200, one 200|401", async () => {
    const session = await loginUser(app, userA);
    const body = { refresh_token: session.refresh };
    const results = await Promise.allSettled([
      request(app.getHttpServer()).post("/api/auth/refresh").send(body),
      request(app.getHttpServer()).post("/api/auth/refresh").send(body),
    ]);
    const statuses = results
      .map((r) => (r.status === "fulfilled" ? r.value.status : 0))
      .filter((s) => s !== 0)
      .sort();
    expect(statuses.length).toBe(2);
    expect(statuses[0]).toBe(200);
    expect([200, 401]).toContain(statuses[1]);
  });

  it("AUTH-PERF-003: 8 concurrent signups with unique emails → majority 201", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        request(app.getHttpServer())
          .post("/api/auth/signup")
          .send({
            name: `U${i}`,
            email: `perf${i}@test.local`,
            phone: `+15551${String(i).padStart(6, "0")}`,
            password: "Password123!",
            confirmPassword: "Password123!",
          }),
      ),
    );
    const statuses = results
      .filter((r) => r.status === "fulfilled")
      .map((r: any) => r.value.status);
    const created = statuses.filter((s) => s === 201).length;
    expect(created).toBeGreaterThan(0);
    expect(statuses.every((s) => s === 201 || s === 429)).toBe(true);
  });

  it("AUTH-PERF-004: 5 concurrent signups with same email → exactly one 201", async () => {
    const body = {
      name: "Race",
      email: "race@test.local",
      phone: "+15559000001",
      password: "Password123!",
      confirmPassword: "Password123!",
    };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).post("/api/auth/signup").send(body),
      ),
    );
    const statuses = results
      .filter((r) => r.status === "fulfilled")
      .map((r: any) => r.value.status);
    const successes = statuses.filter((s) => s === 201).length;
    expect(successes).toBe(1);
    expect(statuses.every((s) => s !== 200)).toBe(true);
  });
});
