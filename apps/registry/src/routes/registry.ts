import { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '@mcp-manager/prisma';

/**
 * MCP Registry Service Routes
 * 
 * Implements the OFFICIAL MCP Registry v0.1 Specification for GitHub Copilot integration.
 * This matches the exact response format from https://github.com/modelcontextprotocol/registry
 * 
 * Reference:
 * - Official MCP Registry: https://github.com/modelcontextprotocol/registry
 * - Live API Docs: https://registry.modelcontextprotocol.io/docs
 * - GitHub Docs: https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-registry
 * 
 * API Versioning (from official repo):
 * - /v0.1/ = Stable API version (API freeze since 2025-10-24)
 * - /v0/ = Development version (may have breaking changes)
 * 
 * Required Endpoints (v0.1 specification):
 * - GET /v0.1/servers - List all MCP servers with pagination
 * - GET /v0.1/servers/{serverName}/versions/latest - Get latest version of a server
 * - GET /v0.1/servers/{serverName}/versions/{version} - Get specific version details
 * - GET /v0.1/servers/{serverName}/versions - Get all versions of a server
 * 
 * Response Format (matching official registry):
 * ```json
 * {
 *   "servers": [{
 *     "server": { "name": "...", "description": "...", "version": "..." },
 *     "_meta": { 
 *       "io.modelcontextprotocol.registry/official": { 
 *         "status": "active", "publishedAt": "...", "isLatest": true 
 *       }
 *     }
 *   }],
 *   "metadata": { "count": 10, "nextCursor": "..." }
 * }
 * ```
 * 
 * IMPORTANT: This is a DISCOVERY-TIME service, NOT a runtime service.
 * The Gateway endpoint in remotes[] handles actual MCP traffic.
 */

// Meta namespace for MCP Manager registry extensions
const META_NAMESPACE = 'io.mcp-manager/enterprise';

// Type helpers for Prisma results
type ToolSchema = {
  name: string;
  displayName?: string | null;
  description: string | null;
  inputSchema?: Prisma.JsonValue;
  capabilities?: Prisma.JsonValue;
  isDangerous?: boolean;
};

type ServerVersion = {
  version: string;
  riskLevel: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  toolSchemas: ToolSchema[];
};

type ServerWithVersions = {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  transport: string;
  repository: string | null;
  homepage: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  versions: ServerVersion[];
  org: { slug: string };
};

export async function registryRoutes(fastify: FastifyInstance) {
  /**
   * GET /v0.1/servers
   * 
   * List all approved MCP servers available in the registry.
   * Matches official MCP Registry response format exactly.
   * 
   * Query Parameters:
   * - limit: Number of items per page (default: 30, max: 100)
   * - cursor: Pagination cursor for next page
   * - search: Search servers by name (substring match)
   * - version: Filter by version ('latest' for latest only)
   * - updated_since: Filter servers updated since timestamp (RFC3339)
   * - org: Filter by organization slug (MCP Manager extension)
   */
  fastify.get('/servers', async (request, reply) => {
    // Query parameters matching official registry
    const { 
      limit = '30', 
      cursor,
      search,
      version: versionFilter,
      updated_since,
      org: orgSlug 
    } = request.query as {
      limit?: string;
      cursor?: string;
      search?: string;
      version?: string;
      updated_since?: string;
      org?: string;
    };

    // Also support org via header
    const effectiveOrgSlug = orgSlug || (request.headers['x-organization-id'] as string);

    const parsedLimit = Math.min(parseInt(limit) || 30, 100);

    // Build query for approved servers
    const where: any = {
      status: 'ACTIVE',
      versions: {
        some: {
          status: 'APPROVED',
        },
      },
    };

    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Updated since filter
    if (updated_since) {
      try {
        const updatedTime = new Date(updated_since);
        where.updatedAt = { gte: updatedTime };
      } catch {
        // Invalid date format, ignore filter
      }
    }

    // Cursor-based pagination
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
        const [cursorName, cursorVersion] = decoded.split(':');
        where.OR = [
          { name: { gt: cursorName } },
          { name: cursorName, versions: { some: { version: { gt: cursorVersion } } } },
        ];
      } catch {
        // Invalid cursor, ignore
      }
    }

    // Organization filter
    if (effectiveOrgSlug) {
      const org = await prisma.organization.findUnique({
        where: { slug: effectiveOrgSlug },
      });
      if (org) {
        where.orgId = org.id;
      } else {
        return reply.send({
          servers: [],
          metadata: { count: 0 },
        });
      }
    } else {
      // Only return public servers if no org specified
      where.isPublic = true;
    }

    const servers = await prisma.server.findMany({
      where,
      include: {
        versions: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          take: versionFilter === 'latest' ? 1 : undefined,
          include: {
            toolSchemas: {
              select: {
                name: true,
                description: true,
              },
            },
          },
        },
        org: {
          select: { slug: true },
        },
      },
      take: parsedLimit + 1, // Fetch one extra to determine if there's a next page
      orderBy: { name: 'asc' },
    });

    // Determine if there's a next page
    const hasNextPage = servers.length > parsedLimit;
    const resultServers = hasNextPage ? servers.slice(0, parsedLimit) : servers;

    // Build next cursor
    let nextCursor: string | undefined;
    if (hasNextPage && resultServers.length > 0) {
      const lastServer = resultServers[resultServers.length - 1]!;
      const lastVersion = lastServer.versions[0]?.version || '';
      nextCursor = Buffer.from(`${lastServer.name}:${lastVersion}`).toString('base64');
    }

    // Transform to OFFICIAL MCP Registry v0.1 format
    // Reference: https://github.com/modelcontextprotocol/registry/blob/main/pkg/api/v0/types.go
    const registryServers = resultServers
      .filter((s: ServerWithVersions) => s.versions.length > 0)
      .map((server: ServerWithVersions) => {
        const latestVersion = server.versions[0]!;
        
        // Gateway endpoint for runtime traffic
        const serverSlug = server.name.includes('/') ? server.name.split('/')[1] : server.name;
        const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${serverSlug}`;

        // Official MCP Registry v0.1 Response Format
        return {
          // Server object - core server information
          server: {
            name: server.name,
            description: server.description || '',
            version: latestVersion.version,
            // Repository info (optional in official spec)
            repository: server.repository ? {
              url: server.repository,
              source: 'github' as const,
              id: server.name,
            } : undefined,
            // Remote transports - points to Gateway
            remotes: [{
              transport_type: server.transport.toLowerCase().replace('_', '-') as 'stdio' | 'sse' | 'streamable-http',
              url: gatewayEndpoint,
            }],
            // Tool definitions
            tools: latestVersion.toolSchemas.map((t: ToolSchema) => ({
              name: t.name,
              description: t.description || '',
            })),
          },
          // Meta object - registry-specific metadata
          _meta: {
            // Official registry namespace
            'io.modelcontextprotocol.registry/official': {
              status: 'active' as const,
              publishedAt: latestVersion.approvedAt?.toISOString() || server.createdAt.toISOString(),
              isLatest: true,
            },
            // MCP Manager enterprise extensions
            [META_NAMESPACE]: {
              orgSlug: server.org.slug,
              riskLevel: latestVersion.riskLevel || 'UNKNOWN',
              approvedAt: latestVersion.approvedAt?.toISOString(),
              gatewayUrl: gatewayEndpoint,
            },
          },
        };
      });

    // Set cache headers
    reply.header('Cache-Control', 'public, max-age=60');

    // Official response format
    return {
      servers: registryServers,
      metadata: {
        count: registryServers.length,
        nextCursor,
      },
    };
  });

  /**
   * GET /v0.1/servers/:name/versions/latest
   * 
   * Get the latest approved version of a specific server.
   * Server name format: namespace/server-name (URL-encoded)
   * 
   * This endpoint is the recommended way to get server details.
   * Note: GET /v0/servers/{serverName} was removed in favor of this endpoint.
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
        title: 'Not Found',
        status: 404,
        detail: 'Server not found or no approved version available',
      });
    }

    const version = server.versions[0]!;
    const serverSlug = server.name.includes('/') ? server.name.split('/')[1] : server.name;
    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${serverSlug}`;

    reply.header('Cache-Control', 'public, max-age=60');

    // Official MCP Registry v0.1 ServerResponse format
    return {
      server: {
        name: server.name,
        description: server.description || '',
        version: version.version,
        repository: server.repository ? {
          url: server.repository,
          source: 'github' as const,
          id: server.name,
        } : undefined,
        remotes: [{
          transport_type: server.transport.toLowerCase().replace('_', '-') as 'stdio' | 'sse' | 'streamable-http',
          url: gatewayEndpoint,
        }],
        tools: version.toolSchemas.map((t: ToolSchema) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema,
        })),
      },
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          status: 'active' as const,
          publishedAt: version.approvedAt?.toISOString() || server.createdAt.toISOString(),
          isLatest: true,
        },
        [META_NAMESPACE]: {
          orgSlug: server.org.slug,
          riskLevel: version.riskLevel || 'UNKNOWN',
          approvedAt: version.approvedAt?.toISOString(),
          gatewayUrl: gatewayEndpoint,
          isDangerous: version.toolSchemas.some((t: ToolSchema) => t.isDangerous),
        },
      },
    };
  });

  /**
   * GET /v0.1/servers/:name/versions/:version
   * 
   * Get a specific version of a server.
   * Both name and version should be URL-encoded.
   */
  fastify.get<{ Params: { name: string; version: string } }>('/servers/:name/versions/:version', async (request, reply) => {
    const { name, version: versionStr } = request.params;
    
    const decodedName = decodeURIComponent(name);
    const decodedVersion = decodeURIComponent(versionStr);

    // Handle 'latest' as special case - redirect to dedicated endpoint
    if (decodedVersion === 'latest') {
      return reply.redirect(`/v0.1/servers/${name}/versions/latest`);
    }

    const server = await prisma.server.findFirst({
      where: {
        name: decodedName,
        status: 'ACTIVE',
      },
      include: {
        versions: {
          where: { 
            version: decodedVersion,
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
        title: 'Not Found',
        status: 404,
        detail: 'Server version not found or not approved',
      });
    }

    const version = server.versions[0]!;
    const serverSlug = server.name.includes('/') ? server.name.split('/')[1] : server.name;
    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${serverSlug}`;

    // Check if this is the latest version
    const latestVersion = await prisma.serverVersion.findFirst({
      where: {
        serverId: server.id,
        status: 'APPROVED',
      },
      orderBy: { createdAt: 'desc' },
      select: { version: true },
    });
    const isLatest = latestVersion?.version === version.version;

    reply.header('Cache-Control', 'public, max-age=300');

    // Official MCP Registry v0.1 ServerResponse format
    return {
      server: {
        name: server.name,
        description: server.description || '',
        version: version.version,
        repository: server.repository ? {
          url: server.repository,
          source: 'github' as const,
          id: server.name,
        } : undefined,
        remotes: [{
          transport_type: server.transport.toLowerCase().replace('_', '-') as 'stdio' | 'sse' | 'streamable-http',
          url: gatewayEndpoint,
        }],
        tools: version.toolSchemas.map((t: ToolSchema) => ({
          name: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema,
        })),
      },
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          status: 'active' as const,
          publishedAt: version.approvedAt?.toISOString() || server.createdAt.toISOString(),
          isLatest,
        },
        [META_NAMESPACE]: {
          orgSlug: server.org.slug,
          riskLevel: version.riskLevel || 'UNKNOWN',
          approvedAt: version.approvedAt?.toISOString(),
          gatewayUrl: gatewayEndpoint,
          isDangerous: version.toolSchemas.some((t: ToolSchema) => t.isDangerous),
        },
      },
    };
  });

  /**
   * GET /v0.1/servers/:name/versions
   * 
   * Get all available versions of a server.
   * Returns a list of all approved versions.
   */
  fastify.get<{ Params: { name: string } }>('/servers/:name/versions', async (request, reply) => {
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
          include: {
            toolSchemas: {
              select: {
                name: true,
                description: true,
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
        title: 'Not Found',
        status: 404,
        detail: 'Server not found or no approved versions available',
      });
    }

    const serverSlug = server.name.includes('/') ? server.name.split('/')[1] : server.name;
    const gatewayEndpoint = `${fastify.gatewayUrl}/mcp/${server.org.slug}/${serverSlug}`;
    const latestVersionStr = server.versions[0]?.version;

    reply.header('Cache-Control', 'public, max-age=60');

    // Return list in official format
    return {
      servers: server.versions.map((version: ServerVersion) => ({
        server: {
          name: server.name,
          description: server.description || '',
          version: version.version,
          repository: server.repository ? {
            url: server.repository,
            source: 'github' as const,
            id: server.name,
          } : undefined,
          remotes: [{
            transport_type: server.transport.toLowerCase().replace('_', '-') as 'stdio' | 'sse' | 'streamable-http',
            url: gatewayEndpoint,
          }],
          tools: version.toolSchemas.map((t: ToolSchema) => ({
            name: t.name,
            description: t.description || '',
          })),
        },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            status: 'active' as const,
            publishedAt: version.approvedAt?.toISOString() || version.createdAt.toISOString(),
            isLatest: version.version === latestVersionStr,
          },
          [META_NAMESPACE]: {
            orgSlug: server.org.slug,
            riskLevel: version.riskLevel || 'UNKNOWN',
            approvedAt: version.approvedAt?.toISOString(),
          },
        },
      })),
      metadata: {
        count: server.versions.length,
      },
    };
  });

  /**
   * GET /v0.1/health
   * 
   * Health check endpoint for the registry service.
   */
  fastify.get('/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return {
      status: 'ok',
    };
  });

  /**
   * GET /v0.1/ping
   * 
   * Simple ping endpoint for connectivity testing.
   */
  fastify.get('/ping', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return {
      pong: true,
    };
  });

  /**
   * GET /v0.1/version
   * 
   * Get registry version information.
   */
  fastify.get('/version', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return {
      version: process.env.npm_package_version || '1.0.0',
      git_commit: process.env.GIT_COMMIT || 'unknown',
      build_time: process.env.BUILD_TIME || new Date().toISOString(),
    };
  });
}
