import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createLogger } from '@mcp-manager/shared';
import { prisma } from '@mcp-manager/prisma';
import { registryRoutes } from './routes/registry.js';
import { healthRoutes } from './routes/health.js';

const logger = createLogger('registry');

const PORT = parseInt(process.env.REGISTRY_PORT || '3002', 10);
const HOST = process.env.HOST || '0.0.0.0';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3003';

/**
 * MCP Manager Registry Service
 * 
 * Implements the official MCP Registry v0.1 specification.
 * GitHub Copilot and other MCP clients discover approved servers through this registry.
 * 
 * API Versioning (matching official registry):
 * - /v0.1/ = Stable API version (API freeze since 2025-10-24)
 * - /v0/ = Development version (alias to v0.1 for compatibility)
 * 
 * Reference:
 * - https://github.com/modelcontextprotocol/registry
 * - https://registry.modelcontextprotocol.io/docs
 */
async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.LOG_FORMAT === 'pretty'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  });

  // CORS is CRITICAL for MCP Registry - GitHub Copilot and other clients need to access from various origins
  // See: https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-registry
  await fastify.register(cors, {
    origin: '*', // Allow all origins for registry discovery
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Organization-Id'],
    credentials: false, // Set to false when using wildcard origin
  });

  // Add explicit CORS headers for all API routes
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/v0.1/') || request.url.startsWith('/v0/')) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Organization-Id');
    }
    return payload;
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Decorate with gateway URL for registry responses
  fastify.decorate('gatewayUrl', GATEWAY_URL);

  // Routes - register for both /v0.1 (stable) and /v0 (development/alias)
  // Both versions currently share identical behavior per official spec
  await fastify.register(healthRoutes, { prefix: '/health' });
  await fastify.register(registryRoutes, { prefix: '/v0.1' });
  await fastify.register(registryRoutes, { prefix: '/v0' }); // v0 alias for compatibility

  // Root endpoint - serve simple UI or redirect to docs
  fastify.get('/', async (_request, reply) => {
    reply.type('text/html').send(`<!DOCTYPE html>
<html>
<head>
  <title>MCP Manager Registry</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    a { color: #0066cc; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    .endpoint { background: #f9f9f9; padding: 10px 15px; border-radius: 5px; margin: 10px 0; }
    .method { color: #22863a; font-weight: bold; }
  </style>
</head>
<body>
  <h1>🔧 MCP Manager Registry</h1>
  <p>Enterprise MCP Registry implementing the <a href="https://github.com/modelcontextprotocol/registry">official MCP Registry v0.1 specification</a>.</p>
  
  <h2>API Endpoints</h2>
  <div class="endpoint">
    <span class="method">GET</span> <a href="/v0.1/servers">/v0.1/servers</a> - List all approved MCP servers
  </div>
  <div class="endpoint">
    <span class="method">GET</span> /v0.1/servers/{name}/versions/latest - Get latest version of a server
  </div>
  <div class="endpoint">
    <span class="method">GET</span> /v0.1/servers/{name}/versions/{version} - Get specific version
  </div>
  <div class="endpoint">
    <span class="method">GET</span> /v0.1/servers/{name}/versions - Get all versions of a server
  </div>
  <div class="endpoint">
    <span class="method">GET</span> <a href="/v0.1/health">/v0.1/health</a> - Health check
  </div>
  <div class="endpoint">
    <span class="method">GET</span> <a href="/v0.1/ping">/v0.1/ping</a> - Ping
  </div>
  <div class="endpoint">
    <span class="method">GET</span> <a href="/v0.1/version">/v0.1/version</a> - Version info
  </div>
  
  <h2>GitHub Copilot Integration</h2>
  <p>Configure this registry in GitHub Enterprise: <code>https://your-registry-url.com</code></p>
  <p>See <a href="https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-registry">GitHub Docs</a> for setup instructions.</p>
</body>
</html>`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await fastify.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    logger.info(`MCP Registry Service running at http://${HOST}:${PORT}`);
    logger.info(`Registry API (stable): http://${HOST}:${PORT}/v0.1/servers`);
    logger.info(`Registry API (dev):    http://${HOST}:${PORT}/v0/servers`);
    logger.info(`Gateway URL: ${GATEWAY_URL}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});

// Type declaration for decorator
declare module 'fastify' {
  interface FastifyInstance {
    gatewayUrl: string;
  }
}
