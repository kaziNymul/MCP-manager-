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

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const AUTH_MODE = process.env.AUTH_MODE || 'development';
const JWT_ISSUER = process.env.JWT_ISSUER || 'mcp-manager-dev';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'mcp-manager';

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

        const user = await prisma.user.findUnique({
          where: { externalId },
          include: {
            org: true,
            teamMemberships: {
              include: { team: true },
            },
          },
        });

        if (!user) {
          throw new AuthenticationError('User not found');
        }

        if (user.status !== 'ACTIVE') {
          throw new AuthorizationError('User account is not active');
        }

        // Build user context
        request.user = {
          userId: user.id,
          email: user.email,
          orgId: user.orgId,
          orgSlug: user.org.slug,
          role: user.role,
          teams: user.teamMemberships.map((tm) => ({
            teamId: tm.teamId,
            teamName: tm.team.name,
            role: tm.role,
          })),
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
  }
}
