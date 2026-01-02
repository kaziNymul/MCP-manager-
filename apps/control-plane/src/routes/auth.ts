import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { prisma } from '@mcp-manager/prisma';
import { createLogger } from '@mcp-manager/shared';

const logger = createLogger('auth-routes');

// Azure AD / OIDC Configuration
const AUTH_MODE = process.env.AUTH_MODE || 'development';
const AZURE_AD_TENANT_ID = process.env.AZURE_AD_TENANT_ID;
const AZURE_AD_CLIENT_ID = process.env.AZURE_AD_CLIENT_ID;
const AZURE_AD_CLIENT_SECRET = process.env.AZURE_AD_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3001/api/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || 'mcp-manager';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'mcp-manager';

// AD group configuration
const AD_ADMIN_GROUPS = (process.env.AD_ADMIN_GROUPS || 'consec-example-admin').split(',').map(g => g.trim());
const AD_USER_GROUPS = (process.env.AD_USER_GROUPS || 'consec-example-users').split(',').map(g => g.trim());
const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG || 'default';

// Azure AD endpoints
function getAzureAdEndpoints() {
  const base = `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}`;
  return {
    authorize: `${base}/oauth2/v2.0/authorize`,
    token: `${base}/oauth2/v2.0/token`,
    jwks: `${base}/discovery/v2.0/keys`,
    userinfo: 'https://graph.microsoft.com/oidc/userinfo',
  };
}

/**
 * Extract AD groups from token claims
 */
function extractAdGroups(claims: any): string[] {
  const groups: string[] = [];
  
  if (Array.isArray(claims.groups)) {
    groups.push(...claims.groups);
  }
  if (Array.isArray(claims.roles)) {
    groups.push(...claims.roles);
  }
  if (Array.isArray(claims.wids)) {
    groups.push(...claims.wids); // Directory roles
  }
  
  return groups;
}

/**
 * Derive role and permissions from AD groups
 */
function derivePermissionsFromGroups(adGroups: string[]): {
  isAdmin: boolean;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
  permissions: string[];
} {
  const isAdmin = adGroups.some(group =>
    AD_ADMIN_GROUPS.some(adminGroup =>
      group.toLowerCase() === adminGroup.toLowerCase() ||
      group.toLowerCase().includes(adminGroup.toLowerCase())
    )
  );

  const isUser = adGroups.some(group =>
    AD_USER_GROUPS.some(userGroup =>
      group.toLowerCase() === userGroup.toLowerCase() ||
      group.toLowerCase().includes(userGroup.toLowerCase())
    )
  );

  if (isAdmin) {
    return {
      isAdmin: true,
      role: 'ADMIN',
      permissions: [
        'servers:read', 'servers:write', 'servers:approve', 'servers:admin',
        'policies:read', 'policies:write',
        'audit:read',
        'teams:read', 'teams:write',
        'orgs:read', 'orgs:write',
        'users:read', 'users:write',
      ],
    };
  }

  if (isUser) {
    return {
      isAdmin: false,
      role: 'MEMBER',
      permissions: [
        'servers:read', 'servers:write',
        'policies:read',
        'audit:read',
        'teams:read',
      ],
    };
  }

  return {
    isAdmin: false,
    role: 'VIEWER',
    permissions: ['servers:read', 'policies:read'],
  };
}

/**
 * Create a session JWT token for the authenticated user
 */
async function createSessionToken(user: any, adGroups: string[], permissions: string[], isAdmin: boolean): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  
  return await new jose.SignJWT({
    sub: user.externalId,
    email: user.email,
    name: user.name,
    userId: user.id,
    orgId: user.orgId,
    orgSlug: user.org?.slug,
    role: user.role,
    groups: adGroups,
    permissions,
    isAdmin,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime('8h')
    .sign(secret);
}

export async function authRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/auth/config
   * Returns auth configuration for the frontend
   */
  fastify.get('/config', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      mode: AUTH_MODE,
      loginUrl: AUTH_MODE === 'development' ? null : '/api/auth/login',
      provider: AUTH_MODE === 'oidc' ? 'azure-ad' : 'development',
      configured: AUTH_MODE === 'oidc' ? !!(AZURE_AD_TENANT_ID && AZURE_AD_CLIENT_ID) : true,
    };
  });

  /**
   * GET /api/auth/login
   * Initiates Azure AD OAuth2 login flow
   * Redirects user to Microsoft login page
   */
  fastify.get('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    if (AUTH_MODE === 'development') {
      return reply.status(400).send({
        error: 'OAuth login not available in development mode',
        message: 'Use token-based authentication in development',
      });
    }

    if (!AZURE_AD_TENANT_ID || !AZURE_AD_CLIENT_ID) {
      return reply.status(500).send({
        error: 'Azure AD not configured',
        message: 'Set AZURE_AD_TENANT_ID and AZURE_AD_CLIENT_ID environment variables',
      });
    }

    const endpoints = getAzureAdEndpoints();
    
    // Generate state for CSRF protection
    const state = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
    
    // Store state in cookie for validation
    reply.setCookie('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    });

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: AZURE_AD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      response_mode: 'query',
      scope: 'openid profile email User.Read',
      state,
      prompt: 'select_account', // Allow user to choose account
    });

    const authUrl = `${endpoints.authorize}?${params.toString()}`;
    
    logger.info({ authUrl: authUrl.split('?')[0] }, 'Redirecting to Azure AD login');
    
    return reply.redirect(authUrl);
  });

  /**
   * GET /api/auth/callback
   * OAuth2 callback handler - exchanges code for tokens
   */
  fastify.get('/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error, error_description } = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    // Handle OAuth errors
    if (error) {
      logger.error({ error, error_description }, 'OAuth error from Azure AD');
      return reply.redirect(`${FRONTEND_URL}/login?error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code) {
      return reply.redirect(`${FRONTEND_URL}/login?error=no_code`);
    }

    // Validate state
    const storedState = request.cookies?.oauth_state;
    if (!storedState || storedState !== state) {
      logger.warn('OAuth state mismatch');
      return reply.redirect(`${FRONTEND_URL}/login?error=state_mismatch`);
    }

    // Clear state cookie
    reply.clearCookie('oauth_state', { path: '/' });

    try {
      const endpoints = getAzureAdEndpoints();

      // Exchange code for tokens
      const tokenResponse = await fetch(endpoints.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: AZURE_AD_CLIENT_ID!,
          client_secret: AZURE_AD_CLIENT_SECRET!,
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        logger.error({ error: errorData }, 'Token exchange failed');
        return reply.redirect(`${FRONTEND_URL}/login?error=token_exchange_failed`);
      }

      const tokens = await tokenResponse.json() as { id_token: string; access_token: string };
      const { id_token, access_token } = tokens;

      // Verify and decode the ID token
      const JWKS = jose.createRemoteJWKSet(new URL(endpoints.jwks));
      const { payload: claims } = await jose.jwtVerify(id_token, JWKS, {
        issuer: `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}/v2.0`,
        audience: AZURE_AD_CLIENT_ID!,
      });

      logger.info({ 
        email: claims.email, 
        name: claims.name,
        sub: claims.sub,
      }, 'User authenticated via Azure AD');

      // Extract AD groups from token
      const adGroups = extractAdGroups(claims);
      const { isAdmin, role, permissions } = derivePermissionsFromGroups(adGroups);

      logger.info({ adGroups, isAdmin, role }, 'User AD group permissions');

      // Find or create user
      let user = await prisma.user.findUnique({
        where: { externalId: claims.sub },
        include: { org: true },
      });

      if (!user) {
        // JIT Provisioning - create user on first login
        // Get or create default organization
        let org = await prisma.organization.findUnique({
          where: { slug: DEFAULT_ORG_SLUG },
        });

        if (!org) {
          org = await prisma.organization.create({
            data: {
              name: DEFAULT_ORG_SLUG,
              displayName: 'Default Organization',
              slug: DEFAULT_ORG_SLUG,
            },
          });
        }

        user = await prisma.user.create({
          data: {
            externalId: claims.sub as string,
            email: (claims.email as string) || (claims.preferred_username as string) || `${claims.sub}@unknown`,
            name: claims.name as string || undefined,
            orgId: org.id,
            role,
            status: 'ACTIVE',
          },
          include: { org: true },
        });

        logger.info({ userId: user.id, email: user.email, adGroups }, 'Created new user from Azure AD');
      } else {
        // Update user's role based on current AD groups
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role,
            name: claims.name as string || user.name,
            lastLoginAt: new Date(),
          },
        });
      }

      // Create session token
      const sessionToken = await createSessionToken(user, adGroups, permissions, isAdmin);

      // Redirect to frontend with token
      // In production, you might want to use HttpOnly cookies instead
      return reply.redirect(`${FRONTEND_URL}/auth/callback?token=${sessionToken}`);

    } catch (err) {
      logger.error({ error: err }, 'OAuth callback error');
      return reply.redirect(`${FRONTEND_URL}/login?error=authentication_failed`);
    }
  });

  /**
   * GET /api/auth/me
   * Returns current user info from token
   */
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest) => {
    const user = request.user!;
    
    return {
      userId: user.userId,
      email: user.email,
      orgId: user.orgId,
      orgSlug: user.orgSlug,
      role: user.role,
      teams: user.teams,
      adGroups: user.adGroups,
      isAdmin: user.isAdmin,
      permissions: user.permissions,
    };
  });

  /**
   * POST /api/auth/logout
   * Clears session (client should clear local token)
   */
  fastify.post('/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    // For Azure AD, you might want to redirect to Azure AD logout
    if (AUTH_MODE === 'oidc' && AZURE_AD_TENANT_ID) {
      const logoutUrl = `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(FRONTEND_URL)}`;
      return { logoutUrl };
    }
    
    return { success: true };
  });

  /**
   * POST /api/auth/dev-login (Development only)
   * Login with a test user for development
   */
  fastify.post('/dev-login', async (request: FastifyRequest, reply: FastifyReply) => {
    if (AUTH_MODE !== 'development') {
      return reply.status(403).send({ error: 'Development login not available in production' });
    }

    const { userId, role } = request.body as { userId?: string; role?: string };
    
    // Find or create a test user
    const externalId = userId || 'auth0|dev-user-001';
    
    let user = await prisma.user.findUnique({
      where: { externalId },
      include: { org: true },
    });

    if (!user) {
      let org = await prisma.organization.findUnique({
        where: { slug: 'default' },
      });

      if (!org) {
        org = await prisma.organization.create({
          data: {
            name: 'default',
            displayName: 'Default Organization',
            slug: 'default',
          },
        });
      }

      user = await prisma.user.create({
        data: {
          externalId,
          email: 'dev@example.com',
          name: 'Development User',
          orgId: org.id,
          role: (role as any) || 'ADMIN',
          status: 'ACTIVE',
        },
        include: { org: true },
      });
    }

    // Determine groups based on role
    const adGroups = role === 'MEMBER' ? ['consec-example-users'] : ['consec-example-admin'];
    const { isAdmin, permissions } = derivePermissionsFromGroups(adGroups);

    const token = await createSessionToken(user, adGroups, permissions, isAdmin);

    return { token, user: { id: user.id, email: user.email, role: user.role } };
  });
}
