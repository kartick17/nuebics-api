import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { SeedUser } from "./seed";

export interface Session {
  bearer: string;
  refresh: string;
  user: any;
}

export async function loginUser(app: INestApplication, u: SeedUser): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ identifier: u.email, password: u.password })
    .expect(200);

  return {
    bearer: res.body.access_token,
    refresh: res.body.refresh_token,
    user: res.body.user_details,
  };
}

export function authed(app: INestApplication, session: Session) {
  const bearer = `Bearer ${session.bearer}`;
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", bearer),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", bearer),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", bearer),
    del: (url: string) => request(app.getHttpServer()).delete(url).set("Authorization", bearer),
  };
}
