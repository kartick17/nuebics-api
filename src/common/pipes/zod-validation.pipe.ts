import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException(formatZodError(parsed.error));
  }
}

export function formatZodError(error: ZodError): string {
  return error.issues?.[0]?.message ?? error.message ?? 'Validation failed';
}
