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

  // Add explicit CORS headers for all /v0.1/servers routes
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/v0.1/servers')) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    return payload;
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Decorate with gateway URL for registry responses
  fastify.decorate('gatewayUrl', GATEWAY_URL);

  // Routes
  await fastify.register(healthRoutes, { prefix: '/health' });
  await fastify.register(registryRoutes, { prefix: '/v0.1' });

  // Root redirect to v0.1
  fastify.get('/', async (_request, reply) => {
    reply.redirect('/v0.1/servers');
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
    logger.info(`Registry Service running at http://${HOST}:${PORT}`);
    logger.info(`Registry API: http://${HOST}:${PORT}/v0.1/servers`);
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
