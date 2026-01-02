import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';
import {
  createServerSchema,
  updateServerSchema,
  createVersionSchema,
  approveVersionSchema,
  NotFoundError,
  AUDIT_EVENT_TYPES,
  createGitHubCopilotManager,
  AuthorizationError,
} from '@mcp-manager/shared';

// GitHub Copilot integration (optional)
const githubCopilot = createGitHubCopilotManager();

// Gateway URL for traffic inspection - all approved servers route through gateway
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3003';

/**
 * Build the Gateway URL for a server
 * This ensures all traffic flows through the Gateway for inspection
 */
function buildGatewayUrl(orgSlug: string, serverName: string): string {
  const serverSlug = serverName.includes('/') ? serverName.split('/')[1] : serverName;
  return `${GATEWAY_URL}/mcp/${orgSlug}/${serverSlug}`;
}

/**
 * Helper to check if user has a specific permission
 */
function hasPermission(user: any, permission: string): boolean {
  const perms = user?.permissions || [];
  return perms.includes(permission) || perms.includes('*') || user?.isAdmin === true;
}

/**
 * Helper to check if user can write to a specific server
 * Admins can write to any server, users can only write to their own
 */
async function canWriteServer(user: any, serverId: string): Promise<boolean> {
  // Admins can write to any server
  if (user.isAdmin || hasPermission(user, 'servers:admin')) {
    return true;
  }

  // Check if user has write permission at all
  if (!hasPermission(user, 'servers:write')) {
    return false;
  }

  // For regular users with servers:write, they can only modify servers they created
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { createdBy: true, orgId: true },
  });

  if (!server || server.orgId !== user.orgId) {
    return false;
  }

  // Check if user created this server
  return server.createdBy === user.userId;
}

export async function serverRoutes(fastify: FastifyInstance) {
  // List servers for user's org
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = request.user!;
    const { status, search } = request.query as { status?: string; search?: string };

    const where: any = { orgId: user.orgId };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const servers = await prisma.server.findMany({
      where,
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            version: true,
            status: true,
            riskScore: true,
            riskLevel: true,
          },
        },
        _count: {
          select: { versions: true, teamAccess: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data: servers };
  });

  // Get single server with versions
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params;
    const user = request.user!;

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          include: {
            toolSchemas: {
              select: {
                id: true,
                name: true,
                displayName: true,
                description: true,
                capabilities: true,
                isDangerous: true,
              },
            },
            approvals: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              include: {
                user: {
                  select: { id: true, email: true, name: true },
                },
              },
            },
          },
        },
        teamAccess: {
          include: {
            team: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
      },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    return { data: server };
  });

  // Register new server
  fastify.post('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user!;
    const data = createServerSchema.parse(request.body);

    // Check permission - admins and users with servers:write can register
    if (!hasPermission(user, 'servers:write')) {
      throw new AuthorizationError('You do not have permission to register servers');
    }

    const server = await prisma.server.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        endpoint: data.endpoint,
        transport: data.transport,
        isPublic: data.isPublic || false,
        homepage: data.homepage,
        repository: data.repository,
        maintainer: data.maintainer,
        tags: data.tags || [],
        orgId: user.orgId,
        status: 'PENDING',
        createdBy: user.userId, // Track who created the server
      },
    });

    // Create initial version
    const version = await prisma.serverVersion.create({
      data: {
        serverId: server.id,
        version: '1.0.0',
        status: 'PENDING_SCAN',
      },
    });

    // Create audit event
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: AUDIT_EVENT_TYPES.SERVER_REGISTERED,
        action: 'create',
        resourceType: 'server',
        resourceId: server.id,
        resourceName: server.name,
        serverName: server.name,
        status: 'SUCCESS',
      },
    });

    return reply.status(201).send({ data: { ...server, latestVersion: version } });
  });

  // Update server
  fastify.put<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;
    const data = updateServerSchema.parse(request.body);

    const existing = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!existing) {
      throw new NotFoundError('Server', id);
    }

    // Check write permission for this specific server
    if (!(await canWriteServer(user, id))) {
      throw new AuthorizationError('You do not have permission to update this server');
    }

    const server = await prisma.server.update({
      where: { id },
      data: {
        displayName: data.displayName,
        description: data.description,
        endpoint: data.endpoint,
        transport: data.transport,
        isPublic: data.isPublic,
        homepage: data.homepage,
        repository: data.repository,
        maintainer: data.maintainer,
        tags: data.tags,
      },
    });

    return { data: server };
  });

  // Delete server
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;

    const existing = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!existing) {
      throw new NotFoundError('Server', id);
    }

    // Only admins or server creators can delete
    if (!(await canWriteServer(user, id))) {
      throw new AuthorizationError('You do not have permission to delete this server');
    }

    await prisma.server.delete({ where: { id } });

    // Create audit event
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: AUDIT_EVENT_TYPES.SERVER_DELETED,
        action: 'delete',
        resourceType: 'server',
        resourceId: id,
        resourceName: existing.name,
        serverName: existing.name,
        status: 'SUCCESS',
      },
    });

    return reply.status(204).send();
  });

  // Create new version
  fastify.post<{ Params: { id: string } }>('/:id/versions', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;
    const data = createVersionSchema.parse(request.body);

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    // Check if version already exists
    const existingVersion = await prisma.serverVersion.findFirst({
      where: { serverId: id, version: data.version },
    });

    if (existingVersion) {
      return reply.status(409).send({ error: 'Version already exists' });
    }

    const version = await prisma.serverVersion.create({
      data: {
        serverId: id,
        version: data.version,
        endpoint: data.endpoint,
        status: 'PENDING_SCAN',
      },
    });

    return reply.status(201).send({ data: version });
  });

  // List versions for a server
  fastify.get<{ Params: { id: string } }>('/:id/versions', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id } = request.params;
    const user = request.user!;

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    const versions = await prisma.serverVersion.findMany({
      where: { serverId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { toolSchemas: true, approvals: true },
        },
      },
    });

    return { data: versions };
  });

  // Get version details with tool schemas
  fastify.get<{ Params: { id: string; versionId: string } }>('/:id/versions/:versionId', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { id, versionId } = request.params;
    const user = request.user!;

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    const version = await prisma.serverVersion.findFirst({
      where: { id: versionId, serverId: id },
      include: {
        toolSchemas: true,
        approvals: {
          include: {
            user: {
              select: { id: true, email: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        scanJobs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!version) {
      throw new NotFoundError('ServerVersion', versionId);
    }

    return { data: version };
  });

  // Approve/Reject version
  fastify.post<{ Params: { id: string; versionId: string } }>('/:id/versions/:versionId/approve', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, versionId } = request.params;
    const user = request.user!;
    const data = approveVersionSchema.parse(request.body);

    // Only admins can approve servers (requires servers:approve permission)
    if (!hasPermission(user, 'servers:approve')) {
      throw new AuthorizationError('You do not have permission to approve servers. This requires admin access.');
    }

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
      include: { org: true },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    const version = await prisma.serverVersion.findFirst({
      where: { id: versionId, serverId: id },
    });

    if (!version) {
      throw new NotFoundError('ServerVersion', versionId);
    }

    // Update version status
    const updatedVersion = await prisma.serverVersion.update({
      where: { id: versionId },
      data: {
        status: data.approved ? 'APPROVED' : 'REJECTED',
        approvedAt: data.approved ? new Date() : null,
      },
    });

    // Create approval record
    await prisma.approval.create({
      data: {
        versionId,
        userId: user.userId,
        decision: data.approved ? 'APPROVED' : 'REJECTED',
        notes: data.notes,
        isAutomatic: false,
      },
    });

    // If approved, activate the server
    if (data.approved) {
      await prisma.server.update({
        where: { id },
        data: { status: 'ACTIVE' },
      });

      // Sync to GitHub Copilot Enterprise (if configured)
      // CRITICAL: Use Gateway URL so all traffic is inspected
      if (githubCopilot) {
        try {
          const gatewayUrl = buildGatewayUrl(server.org.slug, server.name);
          await githubCopilot.addServer({
            name: server.name.replace('/', '-'),
            displayName: server.displayName,
            description: server.description || undefined,
            url: gatewayUrl,
            enabled: true,
          });
          request.log.info({ server: server.name, gatewayUrl }, 'Synced to GitHub Copilot via Gateway');
        } catch (err) {
          request.log.error({ err, server: server.name }, 'Failed to sync to GitHub Copilot');
          // Don't fail the approval, just log the error
        }
      }
    }

    // Audit event
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: data.approved
          ? AUDIT_EVENT_TYPES.VERSION_APPROVED
          : AUDIT_EVENT_TYPES.VERSION_REJECTED,
        action: data.approved ? 'approve' : 'reject',
        resourceType: 'server_version',
        resourceId: versionId,
        resourceName: `${server.name}@${version.version}`,
        serverName: server.name,
        status: 'SUCCESS',
        metadata: { notes: data.notes },
      },
    });

    return { data: updatedVersion };
  });

  // Revoke version (emergency)
  fastify.post<{ Params: { id: string; versionId: string } }>('/:id/versions/:versionId/revoke', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, versionId } = request.params;
    const user = request.user!;
    const { reason } = request.body as { reason?: string };

    // Only admins can revoke
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Only admins can revoke servers' });
    }

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    const version = await prisma.serverVersion.findFirst({
      where: { id: versionId, serverId: id },
    });

    if (!version) {
      throw new NotFoundError('ServerVersion', versionId);
    }

    // Revoke the version
    const updatedVersion = await prisma.serverVersion.update({
      where: { id: versionId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
      },
    });

    // Create revocation record
    await prisma.approval.create({
      data: {
        versionId,
        userId: user.userId,
        decision: 'REVOKED',
        notes: reason || 'Emergency revocation',
        isAutomatic: false,
      },
    });

    // Check if all versions are revoked, suspend server
    const activeVersions = await prisma.serverVersion.count({
      where: { serverId: id, status: 'APPROVED' },
    });

    if (activeVersions === 0) {
      await prisma.server.update({
        where: { id },
        data: { status: 'SUSPENDED' },
      });

      // Remove from GitHub Copilot Enterprise (if configured)
      if (githubCopilot) {
        try {
          await githubCopilot.removeServer(server.name.replace('/', '-'));
          request.log.info({ server: server.name }, 'Removed from GitHub Copilot');
        } catch (err) {
          request.log.error({ err, server: server.name }, 'Failed to remove from GitHub Copilot');
        }
      }
    }

    // Audit event
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: AUDIT_EVENT_TYPES.EMERGENCY_REVOKE,
        action: 'revoke',
        resourceType: 'server_version',
        resourceId: versionId,
        resourceName: `${server.name}@${version.version}`,
        serverName: server.name,
        status: 'SUCCESS',
        metadata: { reason },
      },
    });

    return { data: updatedVersion };
  });

  // Trigger scan for a version
  fastify.post<{ Params: { id: string; versionId: string } }>('/:id/versions/:versionId/scan', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, versionId } = request.params;
    const user = request.user!;

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    const version = await prisma.serverVersion.findFirst({
      where: { id: versionId, serverId: id },
    });

    if (!version) {
      throw new NotFoundError('ServerVersion', versionId);
    }

    // Create scan job
    const scanJob = await prisma.scanJob.create({
      data: {
        versionId,
        status: 'PENDING',
      },
    });

    // Update version status
    await prisma.serverVersion.update({
      where: { id: versionId },
      data: { status: 'PENDING_SCAN' },
    });

    return reply.status(202).send({
      data: {
        message: 'Scan job created',
        scanJobId: scanJob.id,
      },
    });
  });

  // Grant team access to server
  fastify.post<{ Params: { id: string } }>('/:id/access', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;
    const { teamId, accessLevel, allowedTools, deniedTools } = request.body as {
      teamId: string;
      accessLevel?: string;
      allowedTools?: string[];
      deniedTools?: string[];
    };

    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    const team = await prisma.team.findFirst({
      where: { id: teamId, orgId: user.orgId },
    });

    if (!team) {
      throw new NotFoundError('Team', teamId);
    }

    const access = await prisma.teamServerAccess.upsert({
      where: { teamId_serverId: { teamId, serverId: id } },
      create: {
        teamId,
        serverId: id,
        accessLevel: (accessLevel as 'USE' | 'MANAGE') || 'USE',
        allowedTools: allowedTools || [],
        deniedTools: deniedTools || [],
      },
      update: {
        accessLevel: (accessLevel as 'USE' | 'MANAGE') || 'USE',
        allowedTools: allowedTools || [],
        deniedTools: deniedTools || [],
      },
      include: {
        team: {
          select: { id: true, name: true, displayName: true },
        },
      },
    });

    return reply.status(201).send({ data: access });
  });

  // Revoke team access
  fastify.delete<{ Params: { id: string; teamId: string } }>('/:id/access/:teamId', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id, teamId } = request.params;
    const user = request.user!;

    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }

    await prisma.teamServerAccess.deleteMany({
      where: { serverId: id, teamId },
    });

    return reply.status(204).send();
  });

  // ==========================================================================
  // GitHub Copilot Enterprise Sync
  // ==========================================================================

  // Sync all approved servers to GitHub Copilot
  fastify.post('/sync/github-copilot', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user!;

    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Only admins can sync to GitHub Copilot' });
    }

    if (!githubCopilot) {
      return reply.status(400).send({ 
        error: 'GitHub Copilot integration not configured',
        message: 'Set GITHUB_TOKEN and GITHUB_ORG environment variables',
      });
    }

    // Validate connection first
    const validation = await githubCopilot.validateConnection();
    if (!validation.valid) {
      return reply.status(400).send({
        error: 'GitHub Copilot connection failed',
        message: validation.error,
      });
    }

    // Get all approved servers for this org
    const approvedServers = await prisma.server.findMany({
      where: {
        orgId: user.orgId,
        status: 'ACTIVE',
        versions: {
          some: { status: 'APPROVED' },
        },
      },
      include: {
        versions: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Sync to GitHub
    const result = await githubCopilot.syncFromRegistry(
      approvedServers.map((s) => ({
        name: s.name.replace('/', '-'),
        displayName: s.displayName,
        description: s.description || undefined,
        endpoint: s.versions[0]?.endpoint || s.endpoint,
      }))
    );

    // Audit event
    await prisma.auditEvent.create({
      data: {
        orgId: user.orgId,
        userId: user.userId,
        actorType: 'USER',
        eventType: 'GITHUB_COPILOT_SYNC',
        action: 'sync',
        resourceType: 'integration',
        resourceName: 'github-copilot',
        status: result.success ? 'SUCCESS' : 'FAILURE',
        metadata: {
          added: result.added,
          removed: result.removed,
          unchanged: result.unchanged,
          errors: result.errors,
        },
      },
    });

    return { 
      data: result,
      message: result.success 
        ? `Synced ${result.added.length} new, ${result.removed.length} removed, ${result.unchanged.length} unchanged`
        : `Sync completed with ${result.errors.length} errors`,
    };
  });

  // Get GitHub Copilot connection status
  fastify.get('/sync/github-copilot/status', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    if (!githubCopilot) {
      return {
        configured: false,
        message: 'GitHub Copilot integration not configured',
      };
    }

    const validation = await githubCopilot.validateConnection();
    return {
      configured: true,
      ...validation,
    };
  });

  // =========================================================================
  // SOURCE CODE SCANNING
  // =========================================================================

  // Trigger source code scan for a server
  fastify.post<{ Params: { id: string } }>('/:id/scan/source-code', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;
    const { repositoryToken } = request.body as { repositoryToken?: string };

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    if (!server.repositoryUrl) {
      return reply.status(400).send({
        error: 'Source code scanning not configured',
        message: 'Please add a repository URL to enable source code scanning',
      });
    }

    // Import source code scanner dynamically
    const { SourceCodeScanner, getRepositoryAccessInfo } = await import('@mcp-manager/shared');

    // Get token from request or environment
    const token = repositoryToken || 
      process.env.REPOSITORY_ACCESS_TOKEN ||
      process.env.GITHUB_TOKEN;

    if (!token) {
      const accessInfo = getRepositoryAccessInfo(server.repositoryProvider as any || 'GITHUB');
      return reply.status(400).send({
        error: 'Repository access token required',
        message: 'Please provide a repository access token',
        instructions: accessInfo.instructions,
        requiredScopes: accessInfo.requiredScopes,
        setupUrl: accessInfo.setupUrl,
      });
    }

    // Get latest version
    const version = server.versions[0];
    if (!version) {
      return reply.status(400).send({
        error: 'No version found',
        message: 'Please create a server version first',
      });
    }

    // Create scan job
    const scanJob = await prisma.scanJob.create({
      data: {
        versionId: version.id,
        scanType: 'SOURCE_CODE',
        status: 'RUNNING',
        startedAt: new Date(),
        branchName: server.repositoryBranch || 'main',
      },
    });

    // Run scan in background (in production, use a job queue)
    const scanner = new SourceCodeScanner({
      provider: (server.repositoryProvider as any) || 'GITHUB',
      url: server.repositoryUrl,
      branch: server.repositoryBranch || 'main',
      path: server.repositoryPath || '/',
      token,
    });

    // Start async scan
    scanner.scanSourceCode().then(async (result) => {
      // Update scan job
      await prisma.scanJob.update({
        where: { id: scanJob.id },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          completedAt: new Date(),
          results: result as any,
          error: result.error,
          filesScanned: result.filesScanned,
          linesScanned: result.linesScanned,
          commitHash: result.repository.commitHash,
          vulnerabilities: result.vulnerabilities as any,
          vulnerabilityCounts: result.vulnerabilityCounts as any,
        },
      });

      // Update version risk score (combine with API scan if exists)
      const existingScore = version.riskScore || 0;
      const combinedScore = Math.min(100, existingScore + result.riskScore);

      await prisma.serverVersion.update({
        where: { id: version.id },
        data: {
          riskScore: combinedScore,
          riskLevel: combinedScore <= 25 ? 'LOW' :
                     combinedScore <= 50 ? 'MEDIUM' :
                     combinedScore <= 75 ? 'HIGH' : 'CRITICAL',
        },
      });

      // Audit event
      await prisma.auditEvent.create({
        data: {
          orgId: user.orgId,
          userId: user.userId,
          actorType: 'SYSTEM',
          eventType: 'SOURCE_CODE_SCAN_COMPLETED',
          action: 'scan',
          resourceType: 'server_version',
          resourceId: version.id,
          resourceName: `${server.name}@${version.version}`,
          serverName: server.name,
          status: result.success ? 'SUCCESS' : 'FAILURE',
          metadata: {
            filesScanned: result.filesScanned,
            vulnerabilities: result.vulnerabilityCounts as any,
            riskScore: result.riskScore,
          } as any,
        },
      });
    }).catch(async (error) => {
      await prisma.scanJob.update({
        where: { id: scanJob.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: error.message,
        },
      });
    });

    return reply.status(202).send({
      message: 'Source code scan started',
      scanJobId: scanJob.id,
      status: 'RUNNING',
    });
  });

  // Get source code scan results
  fastify.get<{ Params: { id: string } }>('/:id/scan/source-code', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const user = request.user!;

    const server = await prisma.server.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            scanJobs: {
              where: { scanType: 'SOURCE_CODE' },
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
        },
      },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    const version = server.versions[0];
    const scanJobs = version?.scanJobs || [];

    return {
      repositoryUrl: server.repositoryUrl,
      repositoryBranch: server.repositoryBranch,
      repositoryProvider: server.repositoryProvider,
      sourceCodeScanEnabled: server.sourceCodeScanEnabled,
      scanJobs: scanJobs.map((job) => ({
        id: job.id,
        status: job.status,
        scanType: job.scanType,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        filesScanned: job.filesScanned,
        linesScanned: job.linesScanned,
        vulnerabilityCounts: job.vulnerabilityCounts,
        error: job.error,
      })),
      latestScan: scanJobs[0] ? {
        id: scanJobs[0].id,
        status: scanJobs[0].status,
        completedAt: scanJobs[0].completedAt,
        filesScanned: scanJobs[0].filesScanned,
        linesScanned: scanJobs[0].linesScanned,
        vulnerabilities: scanJobs[0].vulnerabilities,
        vulnerabilityCounts: scanJobs[0].vulnerabilityCounts,
      } : null,
    };
  });

  // Get repository access requirements
  fastify.get('/scan/source-code/requirements', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { provider } = request.query as { provider?: string };
    const { getRepositoryAccessInfo } = await import('@mcp-manager/shared');

    if (provider) {
      return getRepositoryAccessInfo(provider as any);
    }

    return {
      github: getRepositoryAccessInfo('GITHUB'),
      gitlab: getRepositoryAccessInfo('GITLAB'),
      bitbucket: getRepositoryAccessInfo('BITBUCKET'),
      azureDevops: getRepositoryAccessInfo('AZURE_DEVOPS'),
    };
  });
}
