import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';
import { createTeamSchema, updateTeamSchema, NotFoundError } from '@mcp-manager/shared';

export async function teamRoutes(fastify: FastifyInstance) {
  // List teams for user's org
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = request.user!;

    const teams = await prisma.team.findMany({
      where: { orgId: user.orgId },
      include: {
        _count: {
          select: { members: true, serverAccess: true, policies: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return { data: teams };
  });

  // Get single team
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params;
    const user = request.user!;

    const team = await prisma.team.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, email: true, name: true, role: true },
            },
          },
        },
        serverAccess: {
          include: {
            server: {
              select: { id: true, name: true, displayName: true, status: true },
            },
          },
        },
        policies: {
          select: { id: true, name: true, type: true, isEnabled: true },
        },
      },
    });

    if (!team) {
      throw new NotFoundError('Team', id);
    }

    return { data: team };
  });

  // Create team
  fastify.post('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user!;
    const data = createTeamSchema.parse(request.body);

    // Check permission
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions to create team' });
    }

    const team = await prisma.team.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        environment: data.environment || 'development',
        orgId: user.orgId,
      },
    });

    return reply.status(201).send({ data: team });
  });

  // Update team
  fastify.put<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;
    const data = updateTeamSchema.parse(request.body);

    // Check team exists and belongs to user's org
    const existing = await prisma.team.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!existing) {
      throw new NotFoundError('Team', id);
    }

    // Check permission
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      // Check if user is team lead
      const membership = user.teams.find((t) => t.teamId === id);
      if (!membership || membership.role !== 'LEAD') {
        return reply.status(403).send({ error: 'Insufficient permissions to update team' });
      }
    }

    const team = await prisma.team.update({
      where: { id },
      data: {
        displayName: data.displayName,
        description: data.description,
        environment: data.environment,
      },
    });

    return { data: team };
  });

  // Delete team
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;

    // Check team exists and belongs to user's org
    const existing = await prisma.team.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!existing) {
      throw new NotFoundError('Team', id);
    }

    // Only admins/owners can delete teams
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions to delete team' });
    }

    await prisma.team.delete({ where: { id } });

    return reply.status(204).send();
  });

  // Add member to team
  fastify.post<{ Params: { id: string } }>('/:id/members', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;
    const { userId, role } = request.body as { userId: string; role?: string };

    // Check team exists
    const team = await prisma.team.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!team) {
      throw new NotFoundError('Team', id);
    }

    // Check permission
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      const membership = user.teams.find((t) => t.teamId === id);
      if (!membership || membership.role !== 'LEAD') {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
    }

    // Check target user exists in same org
    const targetUser = await prisma.user.findFirst({
      where: { id: userId, orgId: user.orgId },
    });

    if (!targetUser) {
      throw new NotFoundError('User', userId);
    }

    const member = await prisma.teamMember.upsert({
      where: { userId_teamId: { userId, teamId: id } },
      create: {
        userId,
        teamId: id,
        role: (role as 'LEAD' | 'MEMBER' | 'VIEWER') || 'MEMBER',
      },
      update: {
        role: (role as 'LEAD' | 'MEMBER' | 'VIEWER') || 'MEMBER',
      },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return reply.status(201).send({ data: member });
  });

  // Remove member from team
  fastify.delete<{ Params: { id: string; userId: string } }>('/:id/members/:userId', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, userId } = request.params;
    const user = request.user!;

    // Check team exists
    const team = await prisma.team.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!team) {
      throw new NotFoundError('Team', id);
    }

    // Check permission
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      const membership = user.teams.find((t) => t.teamId === id);
      if (!membership || membership.role !== 'LEAD') {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
    }

    await prisma.teamMember.deleteMany({
      where: { teamId: id, userId },
    });

    return reply.status(204).send();
  });
}
