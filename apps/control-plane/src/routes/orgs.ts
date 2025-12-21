import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';
import { createOrgSchema, updateOrgSchema, NotFoundError } from '@mcp-manager/shared';

export async function orgRoutes(fastify: FastifyInstance) {
  // List organizations (admin only in production, returns user's org otherwise)
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = request.user!;

    // Non-admins only see their own org
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      const org = await prisma.organization.findUnique({
        where: { id: user.orgId },
        include: {
          _count: {
            select: { teams: true, users: true, servers: true },
          },
        },
      });
      return { data: org ? [org] : [] };
    }

    // Admins see their org with full details
    const orgs = await prisma.organization.findMany({
      where: { id: user.orgId },
      include: {
        _count: {
          select: { teams: true, users: true, servers: true },
        },
      },
    });

    return { data: orgs };
  });

  // Get single organization
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params;
    const user = request.user!;

    // Users can only view their own org
    if (id !== user.orgId && user.role !== 'OWNER') {
      throw new NotFoundError('Organization', id);
    }

    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        teams: {
          select: { id: true, name: true, displayName: true, environment: true },
        },
        _count: {
          select: { users: true, servers: true, policies: true },
        },
      },
    });

    if (!org) {
      throw new NotFoundError('Organization', id);
    }

    return { data: org };
  });

  // Create organization (super admin only - for MVP, we'll allow in dev mode)
  fastify.post('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const data = createOrgSchema.parse(request.body);
    const user = request.user!;

    // Only owners can create orgs (in production, this would be super-admin only)
    if (user.role !== 'OWNER') {
      return reply.status(403).send({ error: 'Only organization owners can create orgs' });
    }

    const org = await prisma.organization.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        slug: data.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        plan: data.plan || 'FREE',
      },
    });

    return reply.status(201).send({ data: org });
  });

  // Update organization
  fastify.put<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params;
    const user = request.user!;
    const data = updateOrgSchema.parse(request.body);

    // Only admins/owners can update their org
    if (id !== user.orgId) {
      throw new NotFoundError('Organization', id);
    }

    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new NotFoundError('Organization', id);
    }

    const org = await prisma.organization.update({
      where: { id },
      data: {
        displayName: data.displayName,
        plan: data.plan,
      },
    });

    return { data: org };
  });

  // Get organization stats
  fastify.get<{ Params: { id: string } }>('/:id/stats', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params;
    const user = request.user!;

    if (id !== user.orgId) {
      throw new NotFoundError('Organization', id);
    }

    const [
      serverCount,
      approvedVersionCount,
      pendingVersionCount,
      policyCount,
      recentAuditCount,
    ] = await Promise.all([
      prisma.server.count({ where: { orgId: id } }),
      prisma.serverVersion.count({
        where: { server: { orgId: id }, status: 'APPROVED' },
      }),
      prisma.serverVersion.count({
        where: { server: { orgId: id }, status: 'PENDING_REVIEW' },
      }),
      prisma.policy.count({ where: { orgId: id } }),
      prisma.auditEvent.count({
        where: {
          orgId: id,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      data: {
        servers: {
          total: serverCount,
          approvedVersions: approvedVersionCount,
          pendingVersions: pendingVersionCount,
        },
        policies: policyCount,
        auditEventsLast24h: recentAuditCount,
      },
    };
  });
}
