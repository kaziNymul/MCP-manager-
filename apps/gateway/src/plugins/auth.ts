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
    correlationId?: string;
  }
}

const AUTH_MODE = process.env.AUTH_MODE || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || 'mcp-manager';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'mcp-manager';

// Validate required environment variables
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

async function authPluginImpl(fastify: FastifyInstance) {
  // Extract correlation ID from headers
  fastify.addHook('preHandler', async (request) => {
    request.correlationId =
      (request.headers['x-correlation-id'] as string) ||
      (request.headers['x-request-id'] as string) ||
      request.id;
  });

  async function verifyToken(token: string): Promise<jose.JWTPayload> {
    if (AUTH_MODE === 'development') {
      const secret = new TextEncoder().encode(JWT_SECRET);
      const { payload } = await jose.jwtVerify(token, secret, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return payload;
    } else {
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

  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, _reply: FastifyReply) {
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

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
      } catch (err) {
        if (err instanceof AuthenticationError || err instanceof AuthorizationError) {
          throw err;
        }
        request.log.error(err, 'Auth error');
        throw new AuthenticationError('Invalid or expired token');
      }
    }
  );

  fastify.decorate(
    'optionalAuth',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const authHeader = request.headers.authorization;
      if (!authHeader) return;

      try {
        await (fastify as any).authenticate(request, reply);
      } catch {
        // Ignore for optional auth
      }
    }
  );
}

export const authPlugin = fp(authPluginImpl, {
  name: 'auth',
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
