import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import * as jose from 'jose';
import { prisma } from '@mcp-manager/prisma';
import { AuthenticationError, AuthorizationError } from '@mcp-manager/shared';
import type { UserContext } from '@mcp-manager/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserContext;
    orgId?: string;
  }
}

const AUTH_MODE = process.env.AUTH_MODE || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || 'mcp-manager';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'mcp-manager';

// AD Group configuration
// Format: comma-separated group names or IDs
const AD_ADMIN_GROUPS = (process.env.AD_ADMIN_GROUPS || 'consec-example-admin').split(',').map(g => g.trim());
const AD_USER_GROUPS = (process.env.AD_USER_GROUPS || 'consec-example-users').split(',').map(g => g.trim());

// Validate required environment variables
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

async function authPluginImpl(fastify: FastifyInstance) {
  // Decode and verify JWT
  async function verifyToken(token: string): Promise<jose.JWTPayload> {
    if (AUTH_MODE === 'development') {
      // Simple HS256 verification for development
      const secret = new TextEncoder().encode(JWT_SECRET);
      const { payload } = await jose.jwtVerify(token, secret, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return payload;
    } else {
      // OIDC mode - use JWKS
      const JWKS_URI = process.env.JWKS_URI;
      if (!JWKS_URI) {
        throw new Error('JWKS_URI not configured for OIDC mode');
      }
      const JWKS = jose.createRemoteJWKSet(new URL(JWKS_URI));
      const { payload } = await jose.jwtVerify(token, JWKS, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return payload;
    }
  }

  /**
   * Extract AD groups from JWT token.
   * 
   * Azure AD includes groups in the 'groups' claim (array of group IDs)
   * or 'roles' claim depending on configuration.
   * 
   * You can also configure Azure AD to include group names in custom claims.
   */
  function extractAdGroups(payload: jose.JWTPayload): string[] {
    const groups: string[] = [];
    
    // Azure AD default: 'groups' claim contains group object IDs
    if (Array.isArray(payload.groups)) {
      groups.push(...payload.groups.map(g => String(g)));
    }
    
    // Azure AD app roles
    if (Array.isArray(payload.roles)) {
      groups.push(...payload.roles.map(r => String(r)));
    }
    
    // Custom claim for group names (if configured in Azure AD)
    if (Array.isArray(payload.group_names)) {
      groups.push(...payload.group_names.map(g => String(g)));
    }
    
    // Okta: 'groups' claim
    if (Array.isArray(payload['cognito:groups'])) {
      groups.push(...payload['cognito:groups'].map(g => String(g)));
    }
    
    return groups;
  }

  /**
   * Determine permissions based on AD group membership.
   */
  function derivePermissionsFromGroups(adGroups: string[]): {
    isAdmin: boolean;
    permissions: string[];
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  } {
    // Check if user is in any admin group
    const isAdmin = adGroups.some(group => 
      AD_ADMIN_GROUPS.some(adminGroup => 
        group.toLowerCase().includes(adminGroup.toLowerCase()) ||
        adminGroup.toLowerCase().includes(group.toLowerCase())
      )
    );

    // Check if user is in any user group
    const isUser = adGroups.some(group => 
      AD_USER_GROUPS.some(userGroup => 
        group.toLowerCase().includes(userGroup.toLowerCase()) ||
        userGroup.toLowerCase().includes(group.toLowerCase())
      )
    );

    if (isAdmin) {
      return {
        isAdmin: true,
        role: 'ADMIN',
        permissions: [
          'servers:read',
          'servers:write',
          'servers:delete',
          'servers:approve',
          'policies:read',
          'policies:write',
          'policies:delete',
          'audit:read',
          'teams:read',
          'teams:write',
          'teams:delete',
          'orgs:read',
          'orgs:write',
          'users:read',
          'users:write',
          'users:delete',
        ],
      };
    }

    if (isUser) {
      return {
        isAdmin: false,
        role: 'MEMBER',
        permissions: [
          'servers:read',
          'servers:write',  // Can add their own servers
          'policies:read',
          'audit:read',
          'teams:read',
        ],
      };
    }

    // Default: viewer with minimal permissions
    return {
      isAdmin: false,
      role: 'VIEWER',
      permissions: [
        'servers:read',
        'policies:read',
      ],
    };
  }

  // Auth decorator
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const authHeader = request.headers.authorization;

      if (!authHeader) {
        throw new AuthenticationError('Missing authorization header');
      }

      const [scheme, token] = authHeader.split(' ');

      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        throw new AuthenticationError('Invalid authorization header format');
      }

      try {
        const payload = await verifyToken(token);

        // Get user from database
        const externalId = payload.sub;
        if (!externalId) {
          throw new AuthenticationError('Token missing subject');
        }

        // Extract AD groups from token
        const adGroups = extractAdGroups(payload);
        const { isAdmin, permissions, role: adRole } = derivePermissionsFromGroups(adGroups);

        // Try to find existing user
        let user = await prisma.user.findUnique({
          where: { externalId },
          include: {
            org: true,
            teamMemberships: {
              include: { team: true },
            },
          },
        });

        // Auto-provision user if not found (JIT provisioning)
        if (!user && (isAdmin || adGroups.length > 0)) {
          // Get or create default org
          let org = await prisma.organization.findFirst({
            where: { slug: process.env.DEFAULT_ORG_SLUG || 'default' },
          });
          
          if (!org) {
            org = await prisma.organization.create({
              data: {
                name: process.env.DEFAULT_ORG_NAME || 'Default Organization',
                displayName: process.env.DEFAULT_ORG_DISPLAY_NAME || 'Default Organization',
                slug: process.env.DEFAULT_ORG_SLUG || 'default',
              },
            });
          }

          // Create user with AD-derived role
          user = await prisma.user.create({
            data: {
              externalId,
              email: (payload.email as string) || (payload.preferred_username as string) || `${externalId}@unknown`,
              name: (payload.name as string) || (payload.given_name as string) || undefined,
              orgId: org.id,
              role: adRole,
              status: 'ACTIVE',
            },
            include: {
              org: true,
              teamMemberships: {
                include: { team: true },
              },
            },
          });

          request.log.info({ userId: user.id, email: user.email, adGroups }, 'Auto-provisioned user from AD groups');
        }

        if (!user) {
          throw new AuthenticationError('User not found and not in authorized AD groups');
        }

        if (user.status !== 'ACTIVE') {
          throw new AuthorizationError('User account is not active');
        }

        // Build user context with AD group info
        // AD groups override database role if AD_GROUPS_OVERRIDE is set
        const useAdRole = process.env.AD_GROUPS_OVERRIDE === 'true';
        
        request.user = {
          userId: user.id,
          email: user.email,
          orgId: user.orgId,
          orgSlug: user.org.slug,
          role: useAdRole ? adRole : user.role,
          teams: user.teamMemberships.map((tm) => ({
            teamId: tm.teamId,
            teamName: tm.team.name,
            role: tm.role,
          })),
          adGroups,
          isAdmin,
          permissions,
        };
        request.orgId = user.orgId;
      } catch (err) {
        if (err instanceof AuthenticationError || err instanceof AuthorizationError) {
          throw err;
        }
        throw new AuthenticationError('Invalid or expired token');
      }
    }
  );

  // Optional auth - doesn't fail if no token, just doesn't set user
  fastify.decorate(
    'optionalAuth',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      const authHeader = request.headers.authorization;
      if (!authHeader) return;

      try {
        await (fastify as any).authenticate(request, _reply);
      } catch {
        // Ignore auth errors for optional auth
      }
    }
  );

  // Require specific roles
  fastify.decorate(
    'requireRole',
    function (...roles: string[]) {
      return async function (request: FastifyRequest, _reply: FastifyReply) {
        if (!request.user) {
          throw new AuthenticationError('Authentication required');
        }

        if (!roles.includes(request.user.role)) {
          throw new AuthorizationError(
            `Required role: ${roles.join(' or ')}. Current role: ${request.user.role}`
          );
        }
      };
    }
  );

  // Require specific permissions (granular, AD-group based)
  fastify.decorate(
    'requirePermission',
    function (...requiredPermissions: string[]) {
      return async function (request: FastifyRequest, _reply: FastifyReply) {
        if (!request.user) {
          throw new AuthenticationError('Authentication required');
        }

        const userPermissions = request.user.permissions || [];
        
        // Check if user has ANY of the required permissions
        const hasPermission = requiredPermissions.some((perm) => 
          userPermissions.includes(perm) || userPermissions.includes('*')
        );

        if (!hasPermission) {
          throw new AuthorizationError(
            `Required permission: ${requiredPermissions.join(' or ')}. ` +
            `Your permissions: ${userPermissions.join(', ') || 'none'}`
          );
        }
      };
    }
  );

  // Require admin access (shortcut for common admin check)
  fastify.decorate(
    'requireAdmin',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      if (!request.user) {
        throw new AuthenticationError('Authentication required');
      }

      if (!request.user.isAdmin) {
        throw new AuthorizationError('Admin access required');
      }
    }
  );

  // Check if user can access a specific server (owner or admin)
  fastify.decorate(
    'canAccessServer',
    function (serverId: string) {
      return async function (request: FastifyRequest, _reply: FastifyReply) {
        if (!request.user) {
          throw new AuthenticationError('Authentication required');
        }

        // Admins can access all servers
        if (request.user.isAdmin) {
          return;
        }

        // Check if user owns the server
        const server = await prisma.server.findUnique({
          where: { id: serverId },
          select: { createdBy: true, orgId: true },
        });

        if (!server) {
          throw new AuthorizationError('Server not found');
        }

        // Check org membership
        if (server.orgId !== request.user.orgId) {
          throw new AuthorizationError('Server belongs to a different organization');
        }

        // For non-admins, check if they created the server (for write operations)
        // Read access is allowed for all org members with servers:read permission
      };
    }
  );
}

export const authPlugin = fp(authPluginImpl, {
  name: 'auth',
});

// Type declarations for decorators
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: string[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      ...permissions: string[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    canAccessServer: (
      serverId: string
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
