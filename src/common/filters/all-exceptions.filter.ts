import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? (exception.getResponse() as any)?.message ?? exception.message
        : 'Internal server error';

    if (status >= 500) this.logger.error(exception);
    res.status(status).json({ ok: false, error: Array.isArray(message) ? message[0] : message });
  }
}
