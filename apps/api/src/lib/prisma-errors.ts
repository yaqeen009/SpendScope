import { ConflictError, NotFoundError, ValidationError } from './errors.ts';

interface PrismaKnownError {
  code: string;
  meta?: Record<string, unknown>;
  message: string;
}

function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

/**
 * Translates Prisma's known error codes into application errors so route
 * handlers never leak raw database messages.
 *
 * P2002 unique violation → 409 Conflict
 * P2025 record not found → 404 Not Found
 * P2003 foreign key violation → 400 Bad Request
 */
export function translatePrismaError(error: unknown, context: { resource?: string; conflict?: string } = {}): never {
  if (isPrismaKnownError(error)) {
    switch (error.code) {
      case 'P2002': {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : undefined;
        throw new ConflictError(
          context.conflict ?? `A record with the same ${fields ?? 'unique fields'} already exists`,
          fields ? { fields: target } : undefined,
        );
      }
      case 'P2025':
        throw new NotFoundError(context.resource ?? 'Record');
      case 'P2003':
        throw new ValidationError('The referenced record does not exist', {
          constraint: error.meta?.field_name,
        });
      default:
        break;
    }
  }
  throw error;
}
