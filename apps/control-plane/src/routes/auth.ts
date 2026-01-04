import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import ldap from 'ldapjs';
import { prisma } from '@mcp-manager/prisma';
import { createLogger } from '@mcp-manager/shared';

const logger = createLogger('auth-routes');

// Authentication Mode: 'ldap' for direct AD login, 'development' for dev mode
const AUTH_MODE = process.env.AUTH_MODE || 'development';

// LDAP / Active Directory Configuration
const LDAP_URL = process.env.LDAP_URL || 'ldap://your-domain-controller.example.com:389';
const LDAP_BASE_DN = process.env.LDAP_BASE_DN || 'DC=example,DC=com';
const LDAP_USER_SEARCH_FILTER = process.env.LDAP_USER_SEARCH_FILTER || '(sAMAccountName={{username}})';
const LDAP_USE_TLS = process.env.LDAP_USE_TLS === 'true';
const AD_DOMAIN = process.env.AD_DOMAIN || 'EXAMPLE'; // NetBIOS domain name

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || 'mcp-manager';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'mcp-manager';

// AD group configuration
const AD_ADMIN_GROUPS = (process.env.AD_ADMIN_GROUPS || 'consec-example-admin').split(',').map(g => g.trim().toLowerCase());
const AD_USER_GROUPS = (process.env.AD_USER_GROUPS || 'consec-example-users').split(',').map(g => g.trim().toLowerCase());
const DEFAULT_ORG_SLUG = process.env.DEFAULT_ORG_SLUG || 'default';

// ============================================================================
// LDAP AUTHENTICATION
// ============================================================================

interface LdapUser {
  dn: string;
  username: string;
  email: string;
  displayName: string;
  groups: string[];
}

/**
 * Authenticate user against Active Directory via LDAP
 */
async function authenticateWithLdap(username: string, password: string): Promise<LdapUser> {
  return new Promise((resolve, reject) => {
    // Create LDAP client
    const client = ldap.createClient({
      url: LDAP_URL,
      tlsOptions: LDAP_USE_TLS ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 10000,
      timeout: 10000,
    });

    client.on('error', (err) => {
      logger.error({ err }, 'LDAP client error');
      reject(new Error('LDAP connection failed'));
    });

    // Build the user DN for binding
    // Support multiple formats: UPN (user@domain.com), DOMAIN\user, or plain username
    let bindDn: string;
    if (username.includes('@')) {
      // User Principal Name format (user@domain.com)
      bindDn = username;
    } else if (username.includes('\\')) {
      // DOMAIN\username format
      bindDn = username;
    } else {
      // Plain username - use domain\user format
      bindDn = `${AD_DOMAIN}\\${username}`;
    }

    logger.debug({ bindDn, ldapUrl: LDAP_URL }, 'Attempting LDAP bind');

    // Attempt to bind (authenticate) with user credentials
    client.bind(bindDn, password, (bindErr) => {
      if (bindErr) {
        client.unbind();
        logger.warn({ bindDn, error: bindErr.message }, 'LDAP bind failed');
        reject(new Error('Invalid username or password'));
        return;
      }

      logger.info({ bindDn }, 'LDAP bind successful');

      // Extract clean username for search
      let cleanUsername: string;
      if (username.includes('\\')) {
        cleanUsername = username.split('\\').pop() || username;
      } else if (username.includes('@')) {
        cleanUsername = username.split('@')[0] || username;
      } else {
        cleanUsername = username;
      }

      // Now search for user details and groups
      const searchFilter = LDAP_USER_SEARCH_FILTER.replace('{{username}}', cleanUsername);
      
      const searchOptions: ldap.SearchOptions = {
        scope: 'sub',
        filter: searchFilter,
        attributes: ['dn', 'sAMAccountName', 'mail', 'displayName', 'memberOf', 'userPrincipalName'],
      };

      client.search(LDAP_BASE_DN, searchOptions, (searchErr, searchRes) => {
        if (searchErr) {
          client.unbind();
          logger.error({ searchErr }, 'LDAP search failed');
          reject(new Error('Failed to retrieve user information'));
          return;
        }

        let userEntry: LdapUser | null = null;

        searchRes.on('searchEntry', (entry) => {
          const attrs = entry.pojo?.attributes || [];
          const getAttribute = (name: string): string => {
            const attr = attrs.find((a: any) => a.type?.toLowerCase() === name.toLowerCase());
            return attr?.values?.[0] || '';
          };
          const getAttributeArray = (name: string): string[] => {
            const attr = attrs.find((a: any) => a.type?.toLowerCase() === name.toLowerCase());
            return attr?.values || [];
          };

          // Extract group names from memberOf DNs
          const memberOf = getAttributeArray('memberOf');
          const groups: string[] = memberOf.map((dn: string) => {
            // Extract CN from DN like "CN=GroupName,OU=Groups,DC=example,DC=com"
            const match = dn.match(/^CN=([^,]+)/i);
            return match && match[1] ? match[1].toLowerCase() : dn.toLowerCase();
          });

          const foundUsername = getAttribute('sAMAccountName') || cleanUsername;
          const foundEmail = getAttribute('mail') || getAttribute('userPrincipalName') || `${cleanUsername}@${AD_DOMAIN.toLowerCase()}.com`;
          const foundDisplayName = getAttribute('displayName') || cleanUsername;
          
          userEntry = {
            dn: entry.pojo?.objectName || bindDn,
            username: foundUsername,
            email: foundEmail,
            displayName: foundDisplayName,
            groups,
          };

          logger.debug({ username: foundUsername, groupCount: groups.length }, 'User found');
        });

        searchRes.on('error', (err) => {
          client.unbind();
          logger.error({ err }, 'LDAP search error');
          reject(new Error('Failed to retrieve user information'));
        });

        searchRes.on('end', () => {
          client.unbind();
          
          if (!userEntry) {
            // User authenticated but couldn't find their entry
            // This can happen with certain AD configurations
            // Return basic info based on username
            logger.warn({ username: cleanUsername }, 'User authenticated but entry not found, using basic info');
            resolve({
              dn: bindDn,
              username: cleanUsername,
              email: `${cleanUsername}@${AD_DOMAIN.toLowerCase()}.com`,
              displayName: cleanUsername,
              groups: [],
            });
            return;
          }

          resolve(userEntry);
        });
      });
    });
  });
}

/**
 * Derive role and permissions from AD groups
 */
function derivePermissionsFromGroups(adGroups: string[]): {
  isAdmin: boolean;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
  permissions: string[];
} {
  const normalizedGroups = adGroups.map(g => g.toLowerCase());
  
  const isAdmin = normalizedGroups.some(group =>
    AD_ADMIN_GROUPS.some(adminGroup =>
      group === adminGroup || group.includes(adminGroup)
    )
  );

  const isUser = normalizedGroups.some(group =>
    AD_USER_GROUPS.some(userGroup =>
      group === userGroup || group.includes(userGroup)
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

// ============================================================================
// ROUTES
// ============================================================================

export async function authRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/auth/config
   * Returns auth configuration for the frontend
   */
  fastify.get('/config', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      mode: AUTH_MODE,
      provider: AUTH_MODE === 'ldap' ? 'active-directory' : 'development',
      configured: AUTH_MODE === 'ldap' ? !!LDAP_URL : true,
      domain: AD_DOMAIN,
    };
  });

  /**
   * POST /api/auth/login
   * Direct login with username and password
   * Authenticates against Active Directory via LDAP
   */
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = request.body as { username?: string; password?: string };

    if (!username || !password) {
      return reply.status(400).send({
        error: 'Missing credentials',
        message: 'Username and password are required',
      });
    }

    // Development mode - accept test credentials
    if (AUTH_MODE === 'development') {
      return handleDevLogin(username, password);
    }

    // LDAP mode - authenticate against Active Directory
    if (AUTH_MODE !== 'ldap') {
      return reply.status(400).send({
        error: 'Invalid auth mode',
        message: 'Authentication mode is not configured for direct login',
      });
    }

    try {
      // Authenticate against AD
      const ldapUser = await authenticateWithLdap(username, password);
      
      logger.info({ 
        username: ldapUser.username, 
        email: ldapUser.email,
        groupCount: ldapUser.groups.length,
      }, 'User authenticated via LDAP');

      // Derive permissions from AD groups
      const { isAdmin, role, permissions } = derivePermissionsFromGroups(ldapUser.groups);

      logger.info({ 
        username: ldapUser.username, 
        isAdmin, 
        role,
        groups: ldapUser.groups.slice(0, 5), // Log first 5 groups
      }, 'User permissions derived from AD groups');

      // Find or create user in database (JIT provisioning)
      let user = await prisma.user.findUnique({
        where: { externalId: `ldap|${ldapUser.username}` },
        include: { org: true },
      });

      if (!user) {
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
            externalId: `ldap|${ldapUser.username}`,
            email: ldapUser.email,
            name: ldapUser.displayName,
            orgId: org.id,
            role,
            status: 'ACTIVE',
          },
          include: { org: true },
        });

        logger.info({ userId: user.id, email: user.email }, 'Created new user from LDAP');
      } else {
        // Update user's role based on current AD groups
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role,
            name: ldapUser.displayName,
            lastLoginAt: new Date(),
          },
        });
      }

      // Create session token
      const token = await createSessionToken(user, ldapUser.groups, permissions, isAdmin);

      return {
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isAdmin,
          groups: ldapUser.groups,
        },
      };

    } catch (err) {
      logger.warn({ err, username }, 'Login failed');
      
      return reply.status(401).send({
        error: 'Authentication failed',
        message: err instanceof Error ? err.message : 'Invalid username or password',
      });
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
  fastify.post('/logout', async (_request: FastifyRequest, _reply: FastifyReply) => {
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
    
    return handleDevLogin(userId || 'dev-admin', 'devpass', role as any);
  });
}

/**
 * Handle development mode login
 */
async function handleDevLogin(
  username: string, 
  _password: string,
  role?: 'ADMIN' | 'MEMBER'
) {
  const externalId = `ldap|${username}`;
  const effectiveRole = role || (username.toLowerCase().includes('admin') ? 'ADMIN' : 'MEMBER');
  
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
        email: `${username}@example.com`,
        name: username,
        orgId: org.id,
        role: effectiveRole,
        status: 'ACTIVE',
      },
      include: { org: true },
    });
  }

  // Determine groups based on role
  const adGroups = effectiveRole === 'ADMIN' ? ['consec-example-admin'] : ['consec-example-users'];
  const { isAdmin, permissions } = derivePermissionsFromGroups(adGroups);

  const token = await createSessionToken(user, adGroups, permissions, isAdmin);

  return { 
    success: true,
    token, 
    user: { 
      id: user.id, 
      email: user.email, 
      name: user.name,
      role: user.role,
      isAdmin,
    } 
  };
}
