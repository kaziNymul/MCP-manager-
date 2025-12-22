import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@mcp-manager/prisma';
import Ajv from 'ajv';
import {
  jsonRpcRequestSchema,
  MCP_JSONRPC,
  createJsonRpcError,
  JSON_RPC_ERRORS,
  NotFoundError,
  PolicyBlockedError,
  ToolNotAllowedError,
  AUDIT_EVENT_TYPES,
  DANGEROUS_TOOL_PATTERNS,
  generateCorrelationId,
  threatDetector,
  anomalyDetector,
} from '@mcp-manager/shared';
import type { JsonRpcRequest, UserContext, ThreatDetectionResult, AnomalyResult } from '@mcp-manager/shared';
import { PolicyEngine } from '../services/policy-engine.js';
import { McpProxy } from '../services/mcp-proxy.js';

// @ts-ignore - Ajv import compatibility
const ajv = new (Ajv.default || Ajv)({ allErrors: true, strict: false });

interface McpParams {
  org: string;
  server: string;
}

/**
 * MCP Gateway Routes
 * 
 * This is the DATA PLANE - where actual MCP traffic flows.
 * 
 * CRITICAL: All MCP traffic goes through this gateway. The gateway:
 * 1. Authenticates the user
 * 2. Resolves org/server to an approved backend MCP server
 * 3. Evaluates policies before each tool call
 * 4. Validates arguments against tool schemas
 * 5. Proxies requests to the backend server
 * 6. Logs everything to the audit trail
 * 
 * The gateway does NOT check the registry at runtime.
 * Registry = discovery-time allowlist (what CAN exist)
 * Gateway = runtime enforcement (what CAN execute)
 */
export async function mcpRoutes(fastify: FastifyInstance) {
  const policyEngine = new PolicyEngine();
  const mcpProxy = new McpProxy();

  /**
   * POST /mcp/:org/:server
   * 
   * Main JSON-RPC endpoint for MCP traffic.
   * Handles initialize, tools/list, tools/call, etc.
   */
  fastify.post<{ Params: McpParams }>('/:org/:server', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { org: orgSlug, server: serverSlug } = request.params;
    const user = request.user!;
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();

    // Parse JSON-RPC request
    let rpcRequest: JsonRpcRequest;
    try {
      rpcRequest = jsonRpcRequestSchema.parse(request.body);
    } catch (err) {
      return reply.send({
        jsonrpc: MCP_JSONRPC.VERSION,
        id: null,
        error: createJsonRpcError(JSON_RPC_ERRORS.PARSE_ERROR, 'Invalid JSON-RPC request'),
      });
    }

    request.log.info({ method: rpcRequest.method, correlationId }, 'MCP request');

    // Resolve server
    const serverInfo = await resolveServer(orgSlug, serverSlug, user);
    if (!serverInfo) {
      return reply.send({
        jsonrpc: MCP_JSONRPC.VERSION,
        id: rpcRequest.id,
        error: createJsonRpcError(
          JSON_RPC_ERRORS.SERVER_NOT_FOUND,
          `Server '${orgSlug}/${serverSlug}' not found or not accessible`
        ),
      });
    }

    // Handle different MCP methods
    try {
      let result: any;

      switch (rpcRequest.method) {
        case 'initialize':
          result = await handleInitialize(serverInfo, rpcRequest);
          break;

        case 'tools/list':
          result = await handleToolsList(serverInfo, user, correlationId);
          break;

        case 'tools/call':
          result = await handleToolsCall(
            serverInfo,
            rpcRequest,
            user,
            correlationId,
            request,
            policyEngine,
            mcpProxy
          );
          break;

        case 'resources/list':
        case 'resources/read':
        case 'prompts/list':
        case 'prompts/get':
          // Proxy other MCP methods directly
          result = await mcpProxy.proxyRequest(serverInfo.endpoint, rpcRequest);
          break;

        default:
          return reply.send({
            jsonrpc: MCP_JSONRPC.VERSION,
            id: rpcRequest.id,
            error: createJsonRpcError(
              JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              `Method '${rpcRequest.method}' not supported`
            ),
          });
      }

      return reply.send({
        jsonrpc: MCP_JSONRPC.VERSION,
        id: rpcRequest.id,
        result,
      });
    } catch (err) {
      request.log.error(err, 'MCP request failed');

      // Log failure to audit
      await prisma.auditEvent.create({
        data: {
          orgId: user.orgId,
          userId: user.userId,
          actorType: 'USER',
          eventType: AUDIT_EVENT_TYPES.TOOLS_CALL,
          action: 'invoke',
          resourceType: 'tool',
          correlationId,
          serverName: `${orgSlug}/${serverSlug}`,
          status: 'FAILURE',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
          durationMs: Date.now() - startTime,
        },
      });

      if (err instanceof PolicyBlockedError || err instanceof ToolNotAllowedError) {
        return reply.send({
          jsonrpc: MCP_JSONRPC.VERSION,
          id: rpcRequest.id,
          error: createJsonRpcError(JSON_RPC_ERRORS.TOOL_BLOCKED, err.message),
        });
      }

      return reply.send({
        jsonrpc: MCP_JSONRPC.VERSION,
        id: rpcRequest.id,
        error: createJsonRpcError(
          JSON_RPC_ERRORS.INTERNAL_ERROR,
          err instanceof Error ? err.message : 'Internal error'
        ),
      });
    }
  });

  /**
   * GET /mcp/:org/:server/sse
   * 
   * Server-Sent Events endpoint for streaming MCP responses.
   */
  fastify.get<{ Params: McpParams }>('/:org/:server/sse', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { org: orgSlug, server: serverSlug } = request.params;
    const user = request.user!;

    // Resolve server
    const serverInfo = await resolveServer(orgSlug, serverSlug, user);
    if (!serverInfo) {
      return reply.status(404).send({ error: 'Server not found' });
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ server: serverInfo.name })}\n\n`);

    // Keep connection alive
    const keepAlive = setInterval(() => {
      reply.raw.write(':keepalive\n\n');
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
    });

    // Note: Full SSE implementation would proxy streaming responses from backend
    // For MVP, we just establish the connection
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

interface ServerInfo {
  id: string;
  name: string;
  endpoint: string;
  orgId: string;
  versionId: string;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: any;
    capabilities: string[];
    isDangerous: boolean;
  }>;
}

async function resolveServer(
  orgSlug: string,
  serverSlug: string,
  user: UserContext
): Promise<ServerInfo | null> {
  // Find org
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
  });

  if (!org) {
    return null;
  }

  // User must belong to this org
  if (org.id !== user.orgId) {
    return null;
  }

  // Find server with approved version
  const server = await prisma.server.findFirst({
    where: {
      orgId: org.id,
      name: { endsWith: `/${serverSlug}` },
      status: 'ACTIVE',
    },
    include: {
      versions: {
        where: { status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          toolSchemas: true,
        },
      },
    },
  });

  if (!server || server.versions.length === 0) {
    return null;
  }

  const version = server.versions[0]!;

  return {
    id: server.id,
    name: server.name,
    endpoint: version.endpoint || server.endpoint,
    orgId: server.orgId,
    versionId: version.id,
    tools: version.toolSchemas.map((t) => ({
      name: t.name,
      description: t.description || undefined,
      inputSchema: t.inputSchema,
      capabilities: t.capabilities,
      isDangerous: t.isDangerous,
    })),
  };
}

async function handleInitialize(
  serverInfo: ServerInfo,
  request: JsonRpcRequest
): Promise<any> {
  return {
    protocolVersion: MCP_JSONRPC.PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    },
    serverInfo: {
      name: serverInfo.name,
      version: '1.0.0',
    },
  };
}

async function handleToolsList(
  serverInfo: ServerInfo,
  user: UserContext,
  correlationId: string
): Promise<any> {
  // Log the tools/list call
  await prisma.auditEvent.create({
    data: {
      orgId: user.orgId,
      userId: user.userId,
      actorType: 'USER',
      eventType: AUDIT_EVENT_TYPES.TOOLS_LIST,
      action: 'list',
      resourceType: 'tool',
      correlationId,
      serverName: serverInfo.name,
      status: 'SUCCESS',
    },
  });

  // Return tools from cached schemas
  return {
    tools: serverInfo.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

async function handleToolsCall(
  serverInfo: ServerInfo,
  request: JsonRpcRequest,
  user: UserContext,
  correlationId: string,
  fastifyRequest: FastifyRequest,
  policyEngine: PolicyEngine,
  mcpProxy: McpProxy
): Promise<any> {
  const params = request.params as { name: string; arguments?: Record<string, unknown> };
  const toolName = params.name;
  const toolArgs = params.arguments || {};
  const startTime = Date.now();
  const requestSize = JSON.stringify(request).length;

  // Find tool schema
  const tool = serverInfo.tools.find((t) => t.name === toolName);
  if (!tool) {
    throw new ToolNotAllowedError(toolName, serverInfo.name, 'Tool not found');
  }

  // =========================================================================
  // SECURITY CHECK 1: Anomaly Detection (rate limiting + behavioral analysis)
  // =========================================================================
  const anomalyResult = anomalyDetector.analyze({
    userId: user.userId,
    serverId: serverInfo.id,
    toolName,
    requestSize,
    ipAddress: fastifyRequest.ip,
    userAgent: fastifyRequest.headers['user-agent'] as string,
  });

  if (anomalyResult.recommendedAction === 'BLOCK') {
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: AUDIT_EVENT_TYPES.TOOLS_BLOCKED,
        action: 'blocked',
        resourceType: 'tool',
        resourceId: toolName,
        resourceName: toolName,
        correlationId,
        toolName,
        serverName: serverInfo.name,
        status: 'BLOCKED',
        errorMessage: 'Anomalous behavior detected',
        metadata: { 
          anomalyScore: anomalyResult.score,
          anomalies: anomalyResult.anomalies.map(a => a.type),
        } as any,
        durationMs: Date.now() - startTime,
        ipAddress: fastifyRequest.ip,
      },
    });
    throw new PolicyBlockedError('Request blocked: anomalous behavior detected', 'anomaly-detection');
  }

  // =========================================================================
  // SECURITY CHECK 2: Threat Detection (prompt injection, data exfil, etc.)
  // =========================================================================
  const threatResult = threatDetector.analyzeToolCall(toolName, toolArgs, {
    userId: user.userId,
    serverId: serverInfo.id,
  });

  if (threatResult.shouldBlock) {
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: AUDIT_EVENT_TYPES.TOOLS_BLOCKED,
        action: 'blocked',
        resourceType: 'tool',
        resourceId: toolName,
        resourceName: toolName,
        correlationId,
        toolName,
        serverName: serverInfo.name,
        arguments: sanitizeArgs(toolArgs) as any,
        status: 'BLOCKED',
        errorMessage: `Security threat detected: ${threatResult.threats.map(t => t.type).join(', ')}`,
        metadata: {
          threatLevel: threatResult.threatLevel,
          threats: threatResult.threats.map(t => ({
            type: t.type,
            severity: t.severity,
            description: t.description,
          })),
        } as any,
        durationMs: Date.now() - startTime,
        ipAddress: fastifyRequest.ip,
      },
    });
    throw new PolicyBlockedError(
      `Security threat detected: ${threatResult.threats[0]?.description || 'malicious input'}`,
      'threat-detection'
    );
  }

  // Check if tool is dangerous and blocked by default
  const isDangerousByPattern = DANGEROUS_TOOL_PATTERNS.some((p) => p.test(toolName));
  if (isDangerousByPattern || tool.isDangerous) {
    // Log blocked attempt
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: AUDIT_EVENT_TYPES.TOOLS_BLOCKED,
        action: 'blocked',
        resourceType: 'tool',
        resourceId: toolName,
        resourceName: toolName,
        correlationId,
        toolName,
        serverName: serverInfo.name,
        arguments: sanitizeArgs(toolArgs) as any,
        status: 'BLOCKED',
        errorMessage: 'Tool is classified as dangerous',
        durationMs: Date.now() - startTime,
      },
    });

    throw new ToolNotAllowedError(
      toolName,
      serverInfo.name,
      'Tool is blocked: classified as dangerous'
    );
  }

  // Evaluate policies
  const policyResult = await policyEngine.evaluateToolCall({
    serverName: serverInfo.name,
    toolName,
    arguments: toolArgs,
    user,
    correlationId,
  });

  if (!policyResult.allowed) {
    // Log blocked attempt
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: AUDIT_EVENT_TYPES.TOOLS_BLOCKED,
        action: 'blocked',
        resourceType: 'tool',
        resourceId: toolName,
        resourceName: toolName,
        correlationId,
        toolName,
        serverName: serverInfo.name,
        arguments: sanitizeArgs(toolArgs) as any,
        status: 'BLOCKED',
        errorMessage: policyResult.reason,
        metadata: { policyName: policyResult.policyName } as any,
        durationMs: Date.now() - startTime,
      },
    });

    throw new PolicyBlockedError(
      policyResult.reason || 'Blocked by policy',
      policyResult.policyName
    );
  }

  // Validate arguments against schema
  if (tool.inputSchema) {
    const validate = ajv.compile(tool.inputSchema);
    if (!validate(toolArgs)) {
      throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors)}`);
    }
  }

  // Proxy request to backend server
  const proxyResult = await mcpProxy.proxyToolCall(
    serverInfo.endpoint,
    toolName,
    toolArgs
  );

  const responseSize = JSON.stringify(proxyResult).length;

  // =========================================================================
  // SECURITY CHECK 4: Response Threat Detection (credential/PII leakage)
  // =========================================================================
  const responseThreats = threatDetector.analyzeToolResponse(toolName, proxyResult, {
    userId: user.userId,
    serverId: serverInfo.id,
  });

  // Check for untrusted content in response (detection only, not prevention)
  const untrustedSignals = detectUntrustedContent(proxyResult);

  // Record call for behavioral learning
  anomalyDetector.recordCall({
    userId: user.userId,
    serverId: serverInfo.id,
    toolName,
    requestSize,
    responseSize,
    success: true,
    blocked: false,
  });

  // Build metadata for audit
  const auditMetadata: Record<string, unknown> = {};
  if (untrustedSignals.length > 0) {
    auditMetadata.untrustedSignals = untrustedSignals;
  }
  if (responseThreats.isThreat) {
    auditMetadata.responseThreats = responseThreats.threats.map(t => ({
      type: t.type,
      severity: t.severity,
    }));
  }
  if (threatResult.isThreat && !threatResult.shouldBlock) {
    auditMetadata.inputThreats = threatResult.threats.map(t => ({
      type: t.type,
      severity: t.severity,
    }));
  }
  if (anomalyResult.isAnomaly) {
    auditMetadata.anomalyScore = anomalyResult.score;
  }

  // Log successful call
  await prisma.auditEvent.create({
    data: {
      orgId: user.orgId,
      userId: user.userId,
      actorType: 'USER',
      eventType: AUDIT_EVENT_TYPES.TOOLS_CALL,
      action: 'invoke',
      resourceType: 'tool',
      resourceId: toolName,
      resourceName: toolName,
      correlationId,
      toolName,
      serverName: serverInfo.name,
      arguments: sanitizeArgs(toolArgs) as any,
      status: responseThreats.requiresReview ? 'FLAGGED' : 'SUCCESS',
      durationMs: Date.now() - startTime,
      metadata: Object.keys(auditMetadata).length > 0 ? auditMetadata as any : undefined,
      ipAddress: fastifyRequest.ip,
      userAgent: fastifyRequest.headers['user-agent'],
    },
  });

  return proxyResult;
}

/**
 * Sanitize arguments for audit logging.
 * Redacts potential secrets and sensitive data.
 */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'token', 'key', 'credential', 'auth'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    const keyLower = key.toLowerCase();
    if (sensitiveKeys.some((s) => keyLower.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 1000) {
      sanitized[key] = value.substring(0, 1000) + '...[truncated]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Detect potential prompt injection or untrusted content in tool output.
 * 
 * IMPORTANT: This is DETECTION ONLY, not prevention.
 * Perfect prompt injection detection is impossible.
 * We flag suspicious patterns for human review.
 */
function detectUntrustedContent(result: any): string[] {
  const signals: string[] = [];

  const text = JSON.stringify(result).toLowerCase();

  // Common injection patterns (detection only)
  const patterns = [
    { pattern: 'ignore previous', signal: 'possible-injection-ignore-previous' },
    { pattern: 'ignore all instructions', signal: 'possible-injection-ignore-all' },
    { pattern: 'you are now', signal: 'possible-injection-role-change' },
    { pattern: 'system:', signal: 'possible-injection-system-prompt' },
    { pattern: 'assistant:', signal: 'possible-injection-assistant' },
    { pattern: '<script', signal: 'html-script-tag' },
    { pattern: 'javascript:', signal: 'javascript-uri' },
    { pattern: '{{', signal: 'template-injection' },
    { pattern: '${', signal: 'template-literal' },
  ];

  for (const { pattern, signal } of patterns) {
    if (text.includes(pattern)) {
      signals.push(signal);
    }
  }

  return signals;
}
