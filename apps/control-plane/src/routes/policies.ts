import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';
import { createPolicySchema, updatePolicySchema, NotFoundError } from '@mcp-manager/shared';

export async function policyRoutes(fastify: FastifyInstance) {
  // List policies for user's org
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = request.user!;
    const { teamId, type, enabled } = request.query as {
      teamId?: string;
      type?: string;
      enabled?: string;
    };

    const where: any = { orgId: user.orgId };

    if (teamId) {
      where.teamId = teamId;
    }

    if (type) {
      where.type = type;
    }

    if (enabled !== undefined) {
      where.isEnabled = enabled === 'true';
    }

    const policies = await prisma.policy.findMany({
      where,
      include: {
        team: {
          select: { id: true, name: true, displayName: true },
        },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return { data: policies };
  });

  // Get single policy
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params;
    const user = request.user!;

    const policy = await prisma.policy.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        team: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    if (!policy) {
      throw new NotFoundError('Policy', id);
    }

    return { data: policy };
  });

  // Create policy
  fastify.post('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user!;
    const data = createPolicySchema.parse(request.body);

    // Only admins can create policies
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    // If team-scoped, verify team exists
    if (data.teamId) {
      const team = await prisma.team.findFirst({
        where: { id: data.teamId, orgId: user.orgId },
      });
      if (!team) {
        throw new NotFoundError('Team', data.teamId);
      }
    }

    const policy = await prisma.policy.create({
      data: {
        name: data.name,
        description: data.description,
        orgId: user.orgId,
        teamId: data.teamId,
        priority: data.priority || 0,
        type: data.type,
        rules: data.rules,
        isEnabled: data.isEnabled ?? true,
      },
      include: {
        team: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    return reply.status(201).send({ data: policy });
  });

  // Update policy
  fastify.put<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;
    const data = updatePolicySchema.parse(request.body);

    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const existing = await prisma.policy.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!existing) {
      throw new NotFoundError('Policy', id);
    }

    const policy = await prisma.policy.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        teamId: data.teamId,
        priority: data.priority,
        type: data.type,
        rules: data.rules,
        isEnabled: data.isEnabled,
      },
      include: {
        team: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    return { data: policy };
  });

  // Delete policy
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;

    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const existing = await prisma.policy.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!existing) {
      throw new NotFoundError('Policy', id);
    }

    await prisma.policy.delete({ where: { id } });

    return reply.status(204).send();
  });

  // Toggle policy enabled/disabled
  fastify.post<{ Params: { id: string } }>('/:id/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;

    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const existing = await prisma.policy.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!existing) {
      throw new NotFoundError('Policy', id);
    }

    const policy = await prisma.policy.update({
      where: { id },
      data: { isEnabled: !existing.isEnabled },
    });

    return { data: policy };
  });

  // Get policy types
  fastify.get('/types', async () => {
    return {
      data: [
        {
          type: 'TOOL_ALLOWLIST',
          name: 'Tool Allowlist',
          description: 'Specify which tools are allowed for a team',
          schemaExample: {
            servers: {
              'org/server-name': {
                tools: ['tool1', 'tool2'],
              },
            },
          },
        },
        {
          type: 'TOOL_DENYLIST',
          name: 'Tool Denylist',
          description: 'Block specific tools or patterns',
          schemaExample: {
            patterns: ['exec*', 'shell*', 'drop_*'],
            reason: 'Dangerous tools blocked by policy',
          },
        },
        {
          type: 'RATE_LIMIT',
          name: 'Rate Limit',
          description: 'Control request rates per user or tool',
          schemaExample: {
            globalLimit: { windowMs: 60000, maxRequests: 100 },
            perToolLimit: { windowMs: 60000, maxRequests: 20 },
          },
        },
        {
          type: 'CAPABILITY_GATE',
          name: 'Capability Gate',
          description: 'Require approval for certain capabilities',
          schemaExample: {
            capabilities: ['write', 'delete'],
            action: 'require_approval',
            message: 'Write operations require approval',
          },
        },
        {
          type: 'ARGUMENT_FILTER',
          name: 'Argument Filter',
          description: 'Validate or filter tool arguments',
          schemaExample: {
            tools: {
              sql_query: {
                disallowPatterns: ['DROP', 'DELETE', 'TRUNCATE'],
              },
            },
          },
        },
        {
          type: 'ANOMALY_DETECTION',
          name: 'Anomaly Detection',
          description: 'Flag unusual usage patterns (detection only)',
          schemaExample: {
            thresholds: {
              rapidCalls: { count: 50, windowMs: 10000 },
              unusualTools: { enabled: true },
            },
          },
        },
      ],
    };
  });
}
