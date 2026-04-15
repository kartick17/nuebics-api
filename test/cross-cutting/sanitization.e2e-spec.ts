import { INestApplication } from "@nestjs/common";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA } from "../helpers/seed";
import { loginUser, authed } from "../helpers/auth";
import {
  PAYLOAD_SQLI_CLASSIC,
  PAYLOAD_SQLI_UNION,
  PAYLOAD_PATH_TRAVERSAL,
  PAYLOAD_NOSQL_OPERATOR,
  PAYLOAD_CRLF_INJECTION,
  PAYLOAD_XSS_SCRIPT,
} from "../helpers/malicious";

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

describe("Cross-cutting — Sanitization matrix", () => {
  it("§6.5-SAN-01: SQLi in file :id → 400 Invalid file ID", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .patch(`/api/files/files/${encodeURIComponent(PAYLOAD_SQLI_CLASSIC)}`)
      .send({ name: "x" })
      .expect(400);
    expect(res.body.error).toBe("Invalid file ID");
  });

  it("§6.5-SAN-02: SQLi UNION in folderId query → 400 Invalid folderId", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .get(`/api/files/files?folderId=${encodeURIComponent(PAYLOAD_SQLI_UNION)}`)
      .expect(400);
    expect(res.body.error).toBe("Invalid folderId");
  });

  it("§6.5-SAN-03: path-traversal in folder :id → 400", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .get(`/api/files/folders/${encodeURIComponent(PAYLOAD_PATH_TRAVERSAL)}`)
      .expect(400);
    expect(res.body.error).toBe("Invalid folder ID");
  });

  it("§6.5-SAN-04: NoSQL operator in string body field → 4xx, never 500", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .patch("/api/files/files/507f1f77bcf86cd799439011")
      .send({ name: PAYLOAD_NOSQL_OPERATOR });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("§6.5-SAN-05: XSS in name round-trips as literal", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/files/folders")
      .send({ name: PAYLOAD_XSS_SCRIPT });
    if (res.status === 201) {
      expect(res.body.folder.name).toBe(PAYLOAD_XSS_SCRIPT);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    } else {
      expect(res.status).toBe(400);
    }
  });

  it("§6.5-SAN-06: CRLF injection never appears in response headers", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/files/folders")
      .send({ name: PAYLOAD_CRLF_INJECTION });
    expect(res.headers["x-injected"]).toBeUndefined();
  });
});
