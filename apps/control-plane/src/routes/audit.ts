import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';
import { auditQuerySchema } from '@mcp-manager/shared';

export async function auditRoutes(fastify: FastifyInstance) {
  // Query audit events
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = request.user!;
    const query = auditQuerySchema.parse(request.query);

    const where: any = { orgId: user.orgId };

    if (query.startDate) {
      where.createdAt = { ...where.createdAt, gte: new Date(query.startDate) };
    }

    if (query.endDate) {
      where.createdAt = { ...where.createdAt, lte: new Date(query.endDate) };
    }

    if (query.eventType) {
      where.eventType = query.eventType;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.serverName) {
      where.serverName = { contains: query.serverName, mode: 'insensitive' };
    }

    if (query.toolName) {
      where.toolName = { contains: query.toolName, mode: 'insensitive' };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.correlationId) {
      where.correlationId = query.correlationId;
    }

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return {
      data: events,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + events.length < total,
      },
    };
  });

  // Get single audit event
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;

    const event = await prisma.auditEvent.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    if (!event) {
      return reply.status(404).send({ error: 'Audit event not found' });
    }

    return { data: event };
  });

  // Get audit summary stats
  fastify.get('/stats', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = request.user!;
    const { hours = '24' } = request.query as { hours?: string };
    const hoursNum = parseInt(hours, 10) || 24;
    const since = new Date(Date.now() - hoursNum * 60 * 60 * 1000);

    const where = { orgId: user.orgId, createdAt: { gte: since } };

    const [
      totalEvents,
      successEvents,
      failureEvents,
      blockedEvents,
      topTools,
      topUsers,
    ] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.count({ where: { ...where, status: 'SUCCESS' } }),
      prisma.auditEvent.count({ where: { ...where, status: 'FAILURE' } }),
      prisma.auditEvent.count({ where: { ...where, status: 'BLOCKED' } }),
      prisma.auditEvent.groupBy({
        by: ['toolName'],
        where: { ...where, toolName: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      prisma.auditEvent.groupBy({
        by: ['userId'],
        where: { ...where, userId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    // Get user details for top users
    const userIds = topUsers.map((u) => u.userId).filter(Boolean) as string[];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      data: {
        period: { hours: hoursNum, since: since.toISOString() },
        totals: {
          total: totalEvents,
          success: successEvents,
          failure: failureEvents,
          blocked: blockedEvents,
        },
        topTools: topTools.map((t) => ({
          tool: t.toolName,
          count: t._count.id,
        })),
        topUsers: topUsers.map((u) => ({
          user: userMap.get(u.userId!) || { id: u.userId },
          count: u._count.id,
        })),
      },
    };
  });

  // Get event types
  fastify.get('/event-types', async () => {
    return {
      data: [
        { type: 'server.registered', category: 'server', description: 'New server registered' },
        { type: 'server.updated', category: 'server', description: 'Server updated' },
        { type: 'server.deleted', category: 'server', description: 'Server deleted' },
        { type: 'version.created', category: 'version', description: 'New version created' },
        { type: 'version.scanned', category: 'version', description: 'Version scanned' },
        { type: 'version.approved', category: 'version', description: 'Version approved' },
        { type: 'version.rejected', category: 'version', description: 'Version rejected' },
        { type: 'version.revoked', category: 'version', description: 'Version revoked' },
        { type: 'tools.list', category: 'mcp', description: 'Tool list requested' },
        { type: 'tools.call', category: 'mcp', description: 'Tool called' },
        { type: 'tools.blocked', category: 'mcp', description: 'Tool call blocked by policy' },
        { type: 'policy.created', category: 'policy', description: 'Policy created' },
        { type: 'policy.updated', category: 'policy', description: 'Policy updated' },
        { type: 'policy.deleted', category: 'policy', description: 'Policy deleted' },
        { type: 'auth.success', category: 'auth', description: 'Authentication success' },
        { type: 'auth.failure', category: 'auth', description: 'Authentication failure' },
        { type: 'admin.emergency_revoke', category: 'admin', description: 'Emergency revocation' },
      ],
    };
  });
}
