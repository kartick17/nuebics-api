import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger
} from '@nestjs/common';
import { Response } from 'express';

interface MongoLikeError {
  name?: string;
  code?: number;
  keyPattern?: Record<string, unknown>;
  path?: string;
  errors?: Record<string, { message?: string }>;
  message?: string;
}

function extractMessage(resp: unknown, fallback: string): string {
  if (typeof resp === 'string') return resp;
  if (resp && typeof resp === 'object') {
    const r = resp as Record<string, unknown>;
    // Prefer `message` (Nest default for `new HttpException("text")`); fall back to
    // `error` (our custom `new HttpException({ error: "text" })` payloads).
    if (typeof r.message === 'string') return r.message;
    if (Array.isArray(r.message) && typeof r.message[0] === 'string')
      return r.message[0];
    if (typeof r.error === 'string') return r.error;
  }
  return fallback;
}

function friendlyDuplicateMessage(
  keyPattern: Record<string, unknown> | undefined
): string {
  const keys = keyPattern ? Object.keys(keyPattern).sort().join(',') : '';
  switch (keys) {
    case 'email':
      return 'Email is already in use';
    case 'phone':
      return 'Phone number is already in use';
    case 'name,parentId,userId':
      return 'A folder with this name already exists here';
    case 'sessionId':
      return 'Session conflict, try again';
    default:
      return 'This entry already exists';
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = 500;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = extractMessage(exception.getResponse(), exception.message);
    } else {
      const e = exception as MongoLikeError;
      if (e?.code === 11000) {
        status = 409;
        message = friendlyDuplicateMessage(e.keyPattern);
      } else if (e?.name === 'CastError') {
        status = 400;
        message =
          e.path === '_id' ? 'Invalid ID' : `Invalid ${e.path ?? 'value'}`;
      } else if (e?.name === 'ValidationError' && e.errors) {
        status = 400;
        const firstKey = Object.keys(e.errors)[0];
        const detail = firstKey ? e.errors[firstKey]?.message : undefined;
        message = detail ?? 'Validation failed';
      }
    }

    if (status >= 500) this.logger.error(exception);
    res.status(status).json({ ok: false, error: message });
  }
}
