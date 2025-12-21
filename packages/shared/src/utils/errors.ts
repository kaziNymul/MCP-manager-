/**
 * Custom error classes for MCP Manager
 */

export class McpManagerError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'McpManagerError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class AuthenticationError extends McpManagerError {
  constructor(message: string = 'Authentication required', details?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends McpManagerError {
  constructor(message: string = 'Access denied', details?: Record<string, unknown>) {
    super(message, 'AUTHORIZATION_ERROR', 403, details);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends McpManagerError {
  constructor(resource: string, id?: string) {
    super(
      `${resource}${id ? ` with id '${id}'` : ''} not found`,
      'NOT_FOUND',
      404,
      { resource, id }
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends McpManagerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends McpManagerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends McpManagerError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, { retryAfter });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class PolicyBlockedError extends McpManagerError {
  public readonly policyName?: string;

  constructor(message: string, policyName?: string) {
    super(message, 'POLICY_BLOCKED', 403, { policyName });
    this.name = 'PolicyBlockedError';
    this.policyName = policyName;
  }
}

export class ToolNotAllowedError extends McpManagerError {
  public readonly toolName: string;
  public readonly serverName: string;

  constructor(toolName: string, serverName: string, reason?: string) {
    super(
      reason || `Tool '${toolName}' from server '${serverName}' is not allowed`,
      'TOOL_NOT_ALLOWED',
      403,
      { toolName, serverName }
    );
    this.name = 'ToolNotAllowedError';
    this.toolName = toolName;
    this.serverName = serverName;
  }
}

export class ScanError extends McpManagerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SCAN_ERROR', 500, details);
    this.name = 'ScanError';
  }
}

// JSON-RPC Error codes
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // MCP-specific errors
  SERVER_NOT_FOUND: -32000,
  TOOL_NOT_FOUND: -32001,
  TOOL_BLOCKED: -32002,
  RATE_LIMITED: -32003,
  VALIDATION_FAILED: -32004,
} as const;

export function createJsonRpcError(
  code: number,
  message: string,
  data?: unknown
): { code: number; message: string; data?: unknown } {
  return { code, message, data };
}
