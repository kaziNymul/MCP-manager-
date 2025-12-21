import { nanoid } from 'nanoid';

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return nanoid(16);
}

/**
 * Generate a request ID
 */
export function generateRequestId(): string {
  return nanoid(12);
}

/**
 * Extract correlation ID from headers
 */
export function extractCorrelationId(
  headers: Record<string, string | string[] | undefined>
): string {
  const correlationId =
    headers['x-correlation-id'] ||
    headers['x-request-id'] ||
    headers['traceparent'];

  if (Array.isArray(correlationId)) {
    return correlationId[0] || generateCorrelationId();
  }

  return correlationId || generateCorrelationId();
}
