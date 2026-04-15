import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { SeedUser } from "./seed";

export interface Session {
  accessCookie: string;
  refreshCookie: string;
  bearer: string;
}

function parseSetCookie(header: string[] | string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const arr = Array.isArray(header) ? header : [header];
  const row = arr.find((h) => h.startsWith(`${name}=`));
  if (!row) return undefined;
  const raw = row.split(";")[0].substring(name.length + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function loginUser(app: INestApplication, u: SeedUser): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ identifier: u.email, password: u.password })
    .expect(200);

  const setCookie = res.headers["set-cookie"] as unknown as string[];
  const accessCookie = parseSetCookie(setCookie, "access_token")!;
  const refreshCookie = parseSetCookie(setCookie, "refresh_token")!;

  return { accessCookie, refreshCookie, bearer: accessCookie };
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
