import { INestApplication } from "@nestjs/common";
import mongoose from "mongoose";
import { createTestApp, closeTestApp } from "../helpers/app";
import { connectTestDb, truncateAll, disconnectTestDb } from "../helpers/db";
import { resetS3Mock } from "../helpers/s3-mock";
import { seedUsers, userA } from "../helpers/seed";
import { loginUser, authed } from "../helpers/auth";

let app: INestApplication;

async function readEmailOtp(email: string): Promise<string> {
  const user = await mongoose.connection.collection("users").findOne({ email });
  return user!.emailVerificationCode as string;
}

async function readPhoneOtp(phone: string): Promise<string> {
  const user = await mongoose.connection.collection("users").findOne({ phone });
  return user!.phoneVerificationCode as string;
}

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

describe("Verification — Happy", () => {
  it("VER-HAPPY-001: GET /auth/verify-email returns status", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session).get("/api/auth/verify-email").expect(200);
    expect(res.body).toEqual({ email: userA.email, isVerified: false });
  });

  it("VER-HAPPY-002: POST /auth/verify-email with valid code → verified", async () => {
    const session = await loginUser(app, userA);
    const code = await readEmailOtp(userA.email);
    const res = await authed(app, session)
      .post("/api/auth/verify-email")
      .send({ code })
      .expect(200);
    expect(res.body.message).toBe("Email verified successfully.");
  });

  it("VER-HAPPY-003: GET /auth/verify-phone returns status", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session).get("/api/auth/verify-phone").expect(200);
    expect(res.body).toEqual({ phone: userA.phone, isVerified: false });
  });

  it("VER-HAPPY-004: POST /auth/verify-phone with valid code → verified", async () => {
    const session = await loginUser(app, userA);
    const code = await readPhoneOtp(userA.phone);
    const res = await authed(app, session)
      .post("/api/auth/verify-phone")
      .send({ code })
      .expect(200);
    expect(res.body.message).toBe("Phone verified successfully.");
  });

  it("VER-HAPPY-005: POST /auth/resend-otp email → sent", async () => {
    const session = await loginUser(app, userA);
    const res = await authed(app, session)
      .post("/api/auth/resend-otp")
      .send({ channel: "email" })
      .expect(200);
    expect(res.body.message).toBe("Verification code sent.");
  });

  it("VER-HAPPY-006: verifying twice → already verified status", async () => {
    const session = await loginUser(app, userA);
    const code = await readEmailOtp(userA.email);
    await authed(app, session).post("/api/auth/verify-email").send({ code }).expect(200);
    const res = await authed(app, session).get("/api/auth/verify-email").expect(200);
    expect(res.body.isVerified).toBe(true);
  });
});
