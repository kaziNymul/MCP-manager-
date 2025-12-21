import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { McpManagerError } from '@mcp-manager/shared';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error);

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'Validation Error',
      code: 'VALIDATION_ERROR',
      details: error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Handle custom MCP Manager errors
  if (error instanceof McpManagerError) {
    return reply.status(error.statusCode).send({
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    if (prismaError.code === 'P2002') {
      return reply.status(409).send({
        error: 'Resource already exists',
        code: 'CONFLICT',
        details: { fields: prismaError.meta?.target },
      });
    }
    if (prismaError.code === 'P2025') {
      return reply.status(404).send({
        error: 'Resource not found',
        code: 'NOT_FOUND',
      });
    }
  }

  // Handle Fastify errors
  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.message,
      code: error.code || 'ERROR',
    });
  }

  // Default 500 error
  return reply.status(500).send({
    error: 'Internal Server Error',
    code: 'INTERNAL_ERROR',
  });
}
