import { z } from 'zod';

// ============================================================================
// MCP Protocol Schemas (JSON-RPC 2.0)
// ============================================================================

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

export const jsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

// ============================================================================
// MCP Tool Schemas
// ============================================================================

export const toolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
  }).passthrough(),
});

export const toolsListResultSchema = z.object({
  tools: z.array(toolDefinitionSchema),
});

export const toolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});

export const toolCallResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
      data: z.string().optional(),
      mimeType: z.string().optional(),
    })
  ),
  isError: z.boolean().optional(),
});

// ============================================================================
// API Request/Response Schemas
// ============================================================================

// Organization schemas
export const createOrgSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(2).max(100),
  plan: z.enum(['FREE', 'TEAM', 'ENTERPRISE']).optional(),
});

export const updateOrgSchema = createOrgSchema.partial();

// Team schemas
export const createTeamSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  environment: z.enum(['development', 'staging', 'production']).optional(),
});

export const updateTeamSchema = createTeamSchema.partial();

// Server schemas
export const createServerSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
  displayName: z.string().min(2).max(100),
  description: z.string().max(1000).optional(),
  endpoint: z.string().url(),
  transport: z.enum(['HTTP_SSE', 'HTTP_STREAMABLE', 'STDIO']).default('HTTP_SSE'),
  isPublic: z.boolean().optional(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  maintainer: z.string().email().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateServerSchema = createServerSchema.partial().omit({ name: true });

// Server version schemas
export const createVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/),
  endpoint: z.string().url().optional(),
});

export const approveVersionSchema = z.object({
  approved: z.boolean(),
  notes: z.string().max(1000).optional(),
});

// Policy schemas
export const createPolicySchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  teamId: z.string().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  type: z.enum([
    'TOOL_ALLOWLIST',
    'TOOL_DENYLIST', 
    'RATE_LIMIT',
    'ARGUMENT_FILTER',
    'CAPABILITY_GATE',
    'ANOMALY_DETECTION',
  ]),
  rules: z.record(z.unknown()),
  isEnabled: z.boolean().optional(),
});

export const updatePolicySchema = createPolicySchema.partial();

// Audit query schema
export const auditQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  eventType: z.string().optional(),
  userId: z.string().optional(),
  serverName: z.string().optional(),
  toolName: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILURE', 'BLOCKED']).optional(),
  correlationId: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});

// ============================================================================
// Registry Response Schemas
// ============================================================================

export const registryServerSchema = z.object({
  name: z.string(),
  version: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  endpoint: z.string(),
  transport: z.string(),
  capabilities: z.array(z.string()).optional(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
  })).optional(),
});

export const registryListResponseSchema = z.object({
  servers: z.array(registryServerSchema),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }).optional(),
});

// ============================================================================
// Gateway Request Schemas
// ============================================================================

export const gatewayToolCallSchema = z.object({
  server: z.string(),
  tool: z.string(),
  arguments: z.record(z.unknown()).optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;
export type JsonRpcError = z.infer<typeof jsonRpcErrorSchema>;
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type ToolsListResult = z.infer<typeof toolsListResultSchema>;
export type ToolCallParams = z.infer<typeof toolCallParamsSchema>;
export type ToolCallResult = z.infer<typeof toolCallResultSchema>;
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type CreateServerInput = z.infer<typeof createServerSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
export type RegistryServer = z.infer<typeof registryServerSchema>;
