import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createLogger } from '@mcp-manager/shared';
import { prisma } from '@mcp-manager/prisma';
import { authPlugin } from './plugins/auth.js';
import { errorHandler } from './plugins/error-handler.js';
import { mcpRoutes } from './routes/mcp.js';
import { healthRoutes } from './routes/health.js';

const logger = createLogger('gateway');

const PORT = parseInt(process.env.GATEWAY_PORT || '3003', 10);
const HOST = process.env.HOST || '0.0.0.0';

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

  // CORS for MCP clients
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Global rate limiting
  await fastify.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    keyGenerator: (request) => {
      // Rate limit by user ID if authenticated, otherwise by IP
      return (request as any).user?.userId || request.ip;
    },
  });

  // Custom error handler
  fastify.setErrorHandler(errorHandler);

  // Auth plugin
  await fastify.register(authPlugin);

  // Routes
  await fastify.register(healthRoutes, { prefix: '/health' });
  await fastify.register(mcpRoutes, { prefix: '/mcp' });

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
    logger.info(`Gateway MCP Server running at http://${HOST}:${PORT}`);
    logger.info(`MCP endpoint: http://${HOST}:${PORT}/mcp/:org/:server`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
