import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get('/', async () => {
    return { status: 'ok', service: 'control-plane', timestamp: new Date().toISOString() };
  });

  // Detailed health check with dependencies
  fastify.get('/ready', async (request, reply) => {
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

    // Check database
    const dbStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latency: Date.now() - dbStart };
    } catch (err) {
      checks.database = {
        status: 'error',
        latency: Date.now() - dbStart,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    const allHealthy = Object.values(checks).every((c) => c.status === 'ok');

    reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'ok' : 'degraded',
      service: 'control-plane',
      timestamp: new Date().toISOString(),
      checks,
    });
  });
}
