import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';

/**
 * Registry Service Routes
 * 
 * IMPORTANT: This is a DISCOVERY-TIME service, NOT a runtime service.
 * 
 * Clients (like GitHub Copilot) query this registry to discover which MCP servers
 * are approved and available. The registry returns:
 * - Server name (canonical identifier)
 * - Version
 * - Endpoint (pointing to the GATEWAY, not the origin server)
 * - Transport type
 * - Available tools (metadata only)
 * 
 * The client then connects to the Gateway endpoint for actual MCP traffic.
 * The Gateway handles runtime enforcement, authentication, and proxying.
 * 
 * This separation is critical:
 * - Registry = "What servers exist and are approved?" (discovery)
 * - Gateway = "Execute this MCP request" (runtime)
 */

export async function registryRoutes(fastify: FastifyInstance) {
  /**
   * GET /v0.1/servers
   * 
   * List all approved MCP servers available in the registry.
   * Optionally filter by organization via header or query param.
   * 
   * This is the primary discovery endpoint for MCP clients.
   */
  fastify.get('/servers', async (request, reply) => {
    // Organization filtering - can be provided via header or query
    const orgSlug = 
      (request.headers['x-organization-id'] as string) ||
      (request.query as { org?: string }).org;

    const { limit = '100', offset = '0' } = request.query as {
      limit?: string;
      offset?: string;
    };

    // Build query for approved servers
    const where: any = {
      status: 'ACTIVE',
      versions: {
        some: {
          status: 'APPROVED',
        },
      },
    };

    // If org specified, filter to that org
    if (orgSlug) {
      const org = await prisma.organization.findUnique({
        where: { slug: orgSlug },
      });
      if (org) {
        where.orgId = org.id;
      } else {
        // Invalid org, return empty
        return reply.send({
          servers: [],
          pagination: { total: 0, limit: parseInt(limit), offset: parseInt(offset) },
        });
      }
    } else {
      // Only return public servers if no org specified
      where.isPublic = true;
    }

    const [servers, total] = await Promise.all([
      prisma.server.findMany({
        where,
        include: {
          versions: {
            where: { status: 'APPROVED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              toolSchemas: {
                select: {
                  name: true,
                  description: true,
                  capabilities: true,
                },
              },
            },
          },
          org: {
            select: { slug: true },
          },
        },
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy: { name: 'asc' },
      }),
      prisma.server.count({ where }),
    ]);

    // Transform to registry format
    const registryServers = servers
      .filter((s) => s.versions.length > 0)
      .map((server) => {
        const latestVersion = server.versions[0]!;
        
        // CRITICAL: Endpoint points to the GATEWAY, not the origin server
        // The gateway URL includes the server name for routing
        const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${server.name.split('/')[1]}`;

        return {
          // Canonical server identifier
          name: server.name,
          
          // Version info
          version: latestVersion.version,
          
          // Display info
          displayName: server.displayName,
          description: server.description,
          
          // GATEWAY endpoint - all traffic goes through gateway
          endpoint: gatewayEndpoint,
          
          // Transport type
          transport: server.transport.toLowerCase().replace('_', '-'),
          
          // Aggregated capabilities from tools
          capabilities: [
            ...new Set(
              latestVersion.toolSchemas.flatMap((t) => t.capabilities)
            ),
          ],
          
          // Tool metadata (not full schemas - those come from tools/list at runtime)
          tools: latestVersion.toolSchemas.map((t) => ({
            name: t.name,
            description: t.description,
          })),
          
          // Metadata
          homepage: server.homepage,
          repository: server.repository,
          tags: server.tags,
        };
      });

    // Set cache headers - registry data can be cached briefly
    reply.header('Cache-Control', 'public, max-age=60');

    return {
      servers: registryServers,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    };
  });

  /**
   * GET /v0.1/servers/:name/versions/latest
   * 
   * Get the latest approved version of a specific server.
   * Server name format: org/server-name
   */
  fastify.get<{ Params: { name: string } }>('/servers/:name/versions/latest', async (request, reply) => {
    const { name } = request.params;
    
    // Name comes URL-encoded, decode it
    const decodedName = decodeURIComponent(name);

    const server = await prisma.server.findFirst({
      where: {
        name: decodedName,
        status: 'ACTIVE',
      },
      include: {
        versions: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            toolSchemas: {
              select: {
                name: true,
                displayName: true,
                description: true,
                inputSchema: true,
                capabilities: true,
                isDangerous: true,
              },
            },
          },
        },
        org: {
          select: { slug: true },
        },
      },
    });

    if (!server || server.versions.length === 0) {
      return reply.status(404).send({
        error: 'Server not found or no approved version available',
        code: 'SERVER_NOT_FOUND',
      });
    }

    const version = server.versions[0]!;
    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${server.name.split('/')[1]}`;

    reply.header('Cache-Control', 'public, max-age=60');

    return {
      name: server.name,
      version: version.version,
      displayName: server.displayName,
      description: server.description,
      endpoint: gatewayEndpoint,
      transport: server.transport.toLowerCase().replace('_', '-'),
      capabilities: [...new Set(version.toolSchemas.flatMap((t) => t.capabilities))],
      tools: version.toolSchemas.map((t) => ({
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        inputSchema: t.inputSchema,
        capabilities: t.capabilities,
        isDangerous: t.isDangerous,
      })),
      riskLevel: version.riskLevel,
      approvedAt: version.approvedAt,
    };
  });

  /**
   * GET /v0.1/servers/:name/versions/:version
   * 
   * Get a specific version of a server.
   */
  fastify.get<{ Params: { name: string; version: string } }>('/servers/:name/versions/:version', async (request, reply) => {
    const { name, version: versionStr } = request.params;
    
    const decodedName = decodeURIComponent(name);

    const server = await prisma.server.findFirst({
      where: {
        name: decodedName,
        status: 'ACTIVE',
      },
      include: {
        versions: {
          where: { 
            version: versionStr,
            status: 'APPROVED',
          },
          include: {
            toolSchemas: {
              select: {
                name: true,
                displayName: true,
                description: true,
                inputSchema: true,
                capabilities: true,
                isDangerous: true,
              },
            },
          },
        },
        org: {
          select: { slug: true },
        },
      },
    });

    if (!server || server.versions.length === 0) {
      return reply.status(404).send({
        error: 'Server version not found or not approved',
        code: 'VERSION_NOT_FOUND',
      });
    }

    const version = server.versions[0]!;
    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${server.name.split('/')[1]}`;

    reply.header('Cache-Control', 'public, max-age=300');

    return {
      name: server.name,
      version: version.version,
      displayName: server.displayName,
      description: server.description,
      endpoint: gatewayEndpoint,
      transport: server.transport.toLowerCase().replace('_', '-'),
      capabilities: [...new Set(version.toolSchemas.flatMap((t) => t.capabilities))],
      tools: version.toolSchemas.map((t) => ({
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        inputSchema: t.inputSchema,
        capabilities: t.capabilities,
        isDangerous: t.isDangerous,
      })),
      riskLevel: version.riskLevel,
      approvedAt: version.approvedAt,
    };
  });

  /**
   * GET /v0.1/servers/:name
   * 
   * Get server info with all available versions.
   */
  fastify.get<{ Params: { name: string } }>('/servers/:name', async (request, reply) => {
    const { name } = request.params;
    const decodedName = decodeURIComponent(name);

    const server = await prisma.server.findFirst({
      where: {
        name: decodedName,
        status: 'ACTIVE',
      },
      include: {
        versions: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          select: {
            version: true,
            riskLevel: true,
            approvedAt: true,
          },
        },
        org: {
          select: { slug: true },
        },
      },
    });

    if (!server) {
      return reply.status(404).send({
        error: 'Server not found',
        code: 'SERVER_NOT_FOUND',
      });
    }

    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${server.name.split('/')[1]}`;

    reply.header('Cache-Control', 'public, max-age=60');

    return {
      name: server.name,
      displayName: server.displayName,
      description: server.description,
      endpoint: gatewayEndpoint,
      transport: server.transport.toLowerCase().replace('_', '-'),
      homepage: server.homepage,
      repository: server.repository,
      tags: server.tags,
      versions: server.versions.map((v) => ({
        version: v.version,
        riskLevel: v.riskLevel,
        approvedAt: v.approvedAt,
      })),
      latestVersion: server.versions[0]?.version,
    };
  });
}
