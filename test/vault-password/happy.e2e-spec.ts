import { INestApplication } from "@nestjs/common";
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

describe("VaultPassword — Happy", () => {
  it("VP-HAPPY-001: POST /auth/vault-password sets vault", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/auth/vault-password")
      .send({ encryptedToken: "opaque-ciphertext" })
      .expect(200);
    expect(res.body).toEqual({ message: "Vault password set successfully." });
  });

  it("VP-HAPPY-002: GET /auth/vault-password returns verifier", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post("/api/auth/vault-password")
      .send({ encryptedToken: "opaque" });
    const res = await authed(app, session).get("/api/auth/vault-password").expect(200);
    expect(res.body).toEqual({ verifier: expect.any(String) });
  });

  it("VP-HAPPY-003: set twice returns credentialChecker", async () => {
    const session = await loginUser(app, userA);
    await authed(app, session)
      .post("/api/auth/vault-password")
      .send({ encryptedToken: "first" })
      .expect(200);
    const res = await authed(app, session)
      .post("/api/auth/vault-password")
      .send({ encryptedToken: "second" })
      .expect(200);
    expect(res.body).toEqual({ credentialChecker: expect.any(String) });
  });
});
