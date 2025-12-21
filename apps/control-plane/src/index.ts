import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createLogger } from '@mcp-manager/shared';
import { prisma } from '@mcp-manager/prisma';
import { authPlugin } from './plugins/auth.js';
import { errorHandler } from './plugins/error-handler.js';
import { orgRoutes } from './routes/orgs.js';
import { teamRoutes } from './routes/teams.js';
import { serverRoutes } from './routes/servers.js';
import { policyRoutes } from './routes/policies.js';
import { auditRoutes } from './routes/audit.js';
import { healthRoutes } from './routes/health.js';

const logger = createLogger('control-plane');

const PORT = parseInt(process.env.CONTROL_PLANE_PORT || '3001', 10);
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

  // Register plugins
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Custom error handler
  fastify.setErrorHandler(errorHandler);

  // Auth plugin
  await fastify.register(authPlugin);

  // Routes
  await fastify.register(healthRoutes, { prefix: '/health' });
  await fastify.register(orgRoutes, { prefix: '/api/orgs' });
  await fastify.register(teamRoutes, { prefix: '/api/teams' });
  await fastify.register(serverRoutes, { prefix: '/api/servers' });
  await fastify.register(policyRoutes, { prefix: '/api/policies' });
  await fastify.register(auditRoutes, { prefix: '/api/audit' });

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
    logger.info(`Control Plane API running at http://${HOST}:${PORT}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
