import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { authed, Session } from "./auth";

export interface SeedUser {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export const userA: SeedUser = {
  name: "User A",
  email: "a@test.local",
  phone: "+15550000001",
  password: "Password123!",
};

export const userB: SeedUser = {
  name: "User B",
  email: "b@test.local",
  phone: "+15550000002",
  password: "Password123!",
};

export async function registerUser(app: INestApplication, u: SeedUser) {
  await request(app.getHttpServer())
    .post("/api/auth/signup")
    .send({
      name: u.name,
      email: u.email,
      phone: u.phone,
      password: u.password,
      confirmPassword: u.password,
    })
    .expect(201);
}

export async function seedUsers(app: INestApplication) {
  await registerUser(app, userA);
  await registerUser(app, userB);
}

export async function createFolder(
  app: INestApplication,
  session: Session,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const res = await authed(app, session)
    .post("/api/files/folders")
    .send({ name, parentId })
    .expect(201);
  return res.body.folder._id;
}

export async function createFile(
  app: INestApplication,
  session: Session,
  opts: { name?: string; folderId?: string | null; size?: number } = {},
): Promise<string> {
  const name = opts.name ?? "file.txt";
  const folderId = opts.folderId ?? null;
  const size = opts.size ?? 100;
  const up = await authed(app, session)
    .post("/api/files/upload")
    .send({ fileName: name, fileType: "text/plain", fileSize: size, folderId })
    .expect(200);
  const conf = await authed(app, session)
    .post("/api/files/confirm")
    .send({
      key: up.body.key,
      fileName: name,
      fileType: "text/plain",
      fileSize: size,
      folderId,
    })
    .expect(201);
  return conf.body.file._id;
}
