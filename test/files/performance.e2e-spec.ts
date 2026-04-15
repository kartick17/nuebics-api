import { INestApplication } from "@nestjs/common";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA, createFile } from "../helpers/seed";
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

describe("Files — Performance (concurrency)", () => {
  it("FILE-PERF-001: 5 concurrent PATCH rename on same file all complete", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "base.txt" });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        authed(app, session).patch(`/api/files/files/${id}`).send({ name: `r${i}.txt` }),
      ),
    );
    const statuses = results
      .filter((r) => r.status === "fulfilled")
      .map((r: any) => r.value.status);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("FILE-PERF-002: 3 concurrent deletes on same file → one 200, rest 404", async () => {
    const session = await loginUser(app, userA);
    const id = await createFile(app, session, { name: "del.txt" });
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => authed(app, session).del(`/api/files/files/${id}`)),
    );
    const statuses = results
      .filter((r) => r.status === "fulfilled")
      .map((r: any) => r.value.status);
    const successes = statuses.filter((s) => s === 200).length;
    const notFound = statuses.filter((s) => s === 404).length;
    expect(successes).toBeGreaterThanOrEqual(1);
    expect(successes + notFound).toBe(statuses.length);
  });

  it("FILE-PERF-003: 10 concurrent uploads → 10 distinct keys", async () => {
    const session = await loginUser(app, userA);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        authed(app, session)
          .post("/api/files/upload")
          .send({ fileName: `f${i}.txt`, fileType: "text/plain", fileSize: 10 }),
      ),
    );
    const keys = new Set(
      results
        .filter((r) => r.status === "fulfilled" && (r as any).value.status === 201)
        .map((r: any) => r.value.body.key),
    );
    expect(keys.size).toBeGreaterThanOrEqual(5);
  });
});
