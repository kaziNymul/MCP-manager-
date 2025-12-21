import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  McpManagerError,
  RateLimitError,
  PolicyBlockedError,
  ToolNotAllowedError,
  createJsonRpcError,
  JSON_RPC_ERRORS,
} from '@mcp-manager/shared';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error);

  // Check if this is a JSON-RPC request (MCP endpoint)
  const isJsonRpc = request.url.includes('/mcp/');

  // Handle rate limit errors
  if (error.statusCode === 429 || error instanceof RateLimitError) {
    if (isJsonRpc) {
      return reply.status(200).send({
        jsonrpc: '2.0',
        id: null,
        error: createJsonRpcError(
          JSON_RPC_ERRORS.RATE_LIMITED,
          'Rate limit exceeded',
          { retryAfter: (error as RateLimitError).retryAfter }
        ),
      });
    }
    return reply.status(429).send({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMITED',
    });
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    if (isJsonRpc) {
      return reply.status(200).send({
        jsonrpc: '2.0',
        id: null,
        error: createJsonRpcError(
          JSON_RPC_ERRORS.INVALID_PARAMS,
          'Invalid parameters',
          error.errors
        ),
      });
    }
    return reply.status(400).send({
      error: 'Validation Error',
      code: 'VALIDATION_ERROR',
      details: error.errors,
    });
  }

  // Handle policy blocked errors
  if (error instanceof PolicyBlockedError) {
    if (isJsonRpc) {
      return reply.status(200).send({
        jsonrpc: '2.0',
        id: null,
        error: createJsonRpcError(
          JSON_RPC_ERRORS.TOOL_BLOCKED,
          error.message,
          { policyName: error.policyName }
        ),
      });
    }
    return reply.status(403).send({
      error: error.message,
      code: 'POLICY_BLOCKED',
      policyName: error.policyName,
    });
  }

  // Handle tool not allowed errors
  if (error instanceof ToolNotAllowedError) {
    if (isJsonRpc) {
      return reply.status(200).send({
        jsonrpc: '2.0',
        id: null,
        error: createJsonRpcError(
          JSON_RPC_ERRORS.TOOL_BLOCKED,
          error.message,
          { toolName: error.toolName, serverName: error.serverName }
        ),
      });
    }
    return reply.status(403).send({
      error: error.message,
      code: 'TOOL_NOT_ALLOWED',
    });
  }

  // Handle custom MCP Manager errors
  if (error instanceof McpManagerError) {
    if (isJsonRpc && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(200).send({
        jsonrpc: '2.0',
        id: null,
        error: createJsonRpcError(
          JSON_RPC_ERRORS.INTERNAL_ERROR,
          error.message,
          error.details
        ),
      });
    }
    return reply.status(error.statusCode).send({
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }

  // Default error handling
  if (isJsonRpc) {
    return reply.status(200).send({
      jsonrpc: '2.0',
      id: null,
      error: createJsonRpcError(
        JSON_RPC_ERRORS.INTERNAL_ERROR,
        'Internal server error'
      ),
    });
  }

  return reply.status(error.statusCode || 500).send({
    error: error.message || 'Internal Server Error',
    code: error.code || 'INTERNAL_ERROR',
  });
}
