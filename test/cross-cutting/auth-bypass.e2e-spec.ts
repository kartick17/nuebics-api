import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers } from "../helpers/seed";
import { forgeAlgNone, tamperSignature, forgeExpiredAccess } from "../helpers/jwt-forge";

let app: INestApplication;
const protectedRoutes: { method: "get" | "post"; path: string }[] = [
  { method: "get", path: "/api/auth/me" },
  { method: "get", path: "/api/files/files" },
  { method: "get", path: "/api/files/folders" },
  { method: "get", path: "/api/files/trash" },
  { method: "get", path: "/api/files/favourites" },
];

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

describe("Cross-cutting — Auth bypass matrix", () => {
  protectedRoutes.forEach(({ method, path }) => {
    it(`§6.1-AB-01: no header → 401 for ${method.toUpperCase()} ${path}`, async () => {
      await (request(app.getHttpServer()) as any)[method](path).expect(401);
    });

    it(`§6.1-AB-02: Basic scheme → 401 for ${path}`, async () => {
      await (request(app.getHttpServer()) as any)
        [method](path)
        .set("Authorization", "Basic dXNlcjpwYXNz")
        .expect(401);
    });

    it(`§6.1-AB-03: empty bearer → 401 for ${path}`, async () => {
      await (request(app.getHttpServer()) as any)
        [method](path)
        .set("Authorization", "Bearer ")
        .expect(401);
    });

    it(`§6.1-AB-04: tampered signature → 401 for ${path}`, async () => {
      const bad = tamperSignature("a.b.c");
      await (request(app.getHttpServer()) as any)
        [method](path)
        .set("Authorization", `Bearer ${bad}`)
        .expect(401);
    });

    it(`§6.1-AB-05: expired JWT → 401 for ${path}`, async () => {
      const expired = await forgeExpiredAccess("507f1f77bcf86cd799439011");
      await (request(app.getHttpServer()) as any)
        [method](path)
        .set("Authorization", `Bearer ${expired}`)
        .expect(401);
    });

    it(`§6.1-AB-08: alg:none JWT → 401 for ${path}`, async () => {
      const forged = await forgeAlgNone("507f1f77bcf86cd799439011");
      await (request(app.getHttpServer()) as any)
        [method](path)
        .set("Authorization", `Bearer ${forged}`)
        .expect(401);
    });
  });
});
