import { FastifyInstance } from 'fastify';
import { prisma } from '@mcp-manager/prisma';

/**
 * MCP Registry Service Routes
 * 
 * Implements the MCP Registry v0.1 Specification for GitHub Copilot integration.
 * 
 * Reference:
 * - GitHub Docs: https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-registry
 * - MCP Registry Spec: https://registry.modelcontextprotocol.io/docs
 * - MCP Registry Repo: https://github.com/modelcontextprotocol/registry
 * 
 * Required Endpoints (v0.1 specification):
 * - GET /v0.1/servers - List all MCP servers
 * - GET /v0.1/servers/{serverName}/versions/latest - Get latest version of a server
 * - GET /v0.1/servers/{serverName}/versions/{version} - Get specific version details
 * 
 * IMPORTANT: This is a DISCOVERY-TIME service, NOT a runtime service.
 * 
 * Clients (GitHub Copilot, VS Code, etc.) query this registry to discover which MCP
 * servers are approved and available. The registry returns:
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

    // Transform to MCP Registry v0.1 specification format
    // Reference: https://github.com/modelcontextprotocol/registry
    const registryServers = servers
      .filter((s) => s.versions.length > 0)
      .map((server) => {
        const latestVersion = server.versions[0]!;
        
        // CRITICAL: Endpoint points to the GATEWAY, not the origin server
        // The gateway URL includes the server name for routing
        const serverSlug = server.name.includes('/') ? server.name.split('/')[1] : server.name;
        const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${serverSlug}`;

        // MCP Registry v0.1 Server Response Format
        return {
          // Server ID (canonical identifier in format org/server-name)
          id: server.name,
          
          // Display name shown to users
          name: server.displayName || server.name,
          
          // Server description
          description: server.description || '',
          
          // Repository URL (for MCP Registry specification)
          repository: {
            url: server.repository || `https://github.com/${server.name}`,
            source: 'github',
          },
          
          // Version information
          version_detail: {
            version: latestVersion.version,
            release_date: latestVersion.approvedAt?.toISOString() || new Date().toISOString(),
            is_latest: true,
          },
          
          // Transport configuration - THIS IS THE KEY PART
          // Points to the GATEWAY endpoint, not the origin server
          remotes: [{
            transport_type: server.transport.toLowerCase().replace('_', '-') as 'stdio' | 'sse' | 'streamable-http',
            url: gatewayEndpoint,
          }],
          
          // Tool metadata (tools will be fully discovered via tools/list at runtime)
          tools: latestVersion.toolSchemas.map((t) => ({
            name: t.name,
            description: t.description || '',
          })),
          
          // Additional metadata
          packages: server.repository ? [{
            registry_name: 'npm',
            name: server.name.split('/')[1] || server.name,
            version: latestVersion.version,
          }] : [],
          
          // Tags/categories
          categories: server.tags || [],
          
          // Links
          homepage: server.homepage || undefined,
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
    const serverSlug = server.name.includes('/') ? server.name.split('/')[1] : server.name;
    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${serverSlug}`;

    reply.header('Cache-Control', 'public, max-age=60');

    // MCP Registry v0.1 Server Version Response Format
    return {
      // Server ID
      id: server.name,
      
      // Display name
      name: server.displayName || server.name,
      
      // Description
      description: server.description || '',
      
      // Repository info
      repository: {
        url: server.repository || `https://github.com/${server.name}`,
        source: 'github',
      },
      
      // Version information
      version_detail: {
        version: version.version,
        release_date: version.approvedAt?.toISOString() || new Date().toISOString(),
        is_latest: true,
      },
      
      // Transport - points to Gateway
      remotes: [{
        transport_type: server.transport.toLowerCase().replace('_', '-') as 'stdio' | 'sse' | 'streamable-http',
        url: gatewayEndpoint,
      }],
      
      // Full tool schemas for this version
      tools: version.toolSchemas.map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema,
      })),
      
      // Risk assessment (MCP Manager extension)
      risk_assessment: {
        level: version.riskLevel || 'UNKNOWN',
        approved_at: version.approvedAt?.toISOString(),
      },
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
    const serverSlug = server.name.includes('/') ? server.name.split('/')[1] : server.name;
    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${serverSlug}`;

    reply.header('Cache-Control', 'public, max-age=300');

    // MCP Registry v0.1 Server Version Response Format
    return {
      // Server ID
      id: server.name,
      
      // Display name
      name: server.displayName || server.name,
      
      // Description
      description: server.description || '',
      
      // Repository info
      repository: {
        url: server.repository || `https://github.com/${server.name}`,
        source: 'github',
      },
      
      // Version information
      version_detail: {
        version: version.version,
        release_date: version.approvedAt?.toISOString() || new Date().toISOString(),
        is_latest: false, // Specific version, may not be latest
      },
      
      // Transport - points to Gateway
      remotes: [{
        transport_type: server.transport.toLowerCase().replace('_', '-') as 'stdio' | 'sse' | 'streamable-http',
        url: gatewayEndpoint,
      }],
      
      // Full tool schemas for this version
      tools: version.toolSchemas.map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema,
      })),
      
      // Risk assessment (MCP Manager extension)
      risk_assessment: {
        level: version.riskLevel || 'UNKNOWN',
        approved_at: version.approvedAt?.toISOString(),
      },
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
