import { HttpException } from '@nestjs/common';

export function throwIfError<T>(
  result: T
): asserts result is Exclude<T, { error: string }> {
  if (
    result &&
    typeof result === 'object' &&
    'error' in result &&
    typeof (result as { error: unknown }).error === 'string'
  ) {
    const r = result as { error: string; status?: number };
    throw new HttpException(r.error, r.status ?? 500);
  }
}
