import { Response } from 'express';
import { ZodError } from 'zod';

export function ok<T extends object>(data: T, status = 200) {
  return { __status: status, body: { ok: true, ...data } } as const;
}

export function err(message: string, status: number) {
  return { __status: status, body: { ok: false, error: message } } as const;
}

export function validationErr(error: ZodError) {
  return {
    __status: 400,
    body: { ok: false, error: error.message ?? 'Validation failed', fields: error.name },
  } as const;
}

export const unauthorized = () => err('Unauthorized. Please log in.', 401);
export const notFound = (thing = 'Resource') => err(`${thing} not found`, 404);

export function tooManyRequests(resetAt: number, res?: Response) {
  const retryAfterSeconds = Math.ceil((resetAt - Date.now()) / 1000);
  if (res) res.setHeader('Retry-After', String(retryAfterSeconds));
  return err(`Too many attempts. Try again in ${retryAfterSeconds} seconds.`, 429);
}

export function send(res: Response, payload: { __status: number; body: object }) {
  res.status(payload.__status).json(payload.body);
}
