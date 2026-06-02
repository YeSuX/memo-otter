import { ZodError } from 'zod';

export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'memory_not_found'
  | 'invalid_state_transition'
  | 'content_too_large'
  | 'internal_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function invalidRequest(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(400, 'invalid_request', message, details);
}

export function unauthorized(message = 'unauthorized'): AppError {
  return new AppError(401, 'unauthorized', message);
}

export function memoryNotFound(id: string): AppError {
  return new AppError(404, 'memory_not_found', `memory not found: ${id}`, { id });
}

export function invalidStateTransition(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(409, 'invalid_state_transition', message, details);
}

export function contentTooLarge(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(413, 'content_too_large', message, details);
}

export function zodToAppError(error: ZodError): AppError {
  return invalidRequest('invalid request', {
    fields: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
  });
}

export function toErrorResponse(error: unknown): {
  status: number;
  body: { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } };
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      }
    };
  }

  console.error(JSON.stringify({ level: 'error', message: 'internal_error', error: String(error) }));
  return {
    status: 500,
    body: {
      error: {
        code: 'internal_error',
        message: 'internal error'
      }
    }
  };
}

export function toJsonErrorResponse(error: unknown): Response {
  const response = toErrorResponse(error);
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
