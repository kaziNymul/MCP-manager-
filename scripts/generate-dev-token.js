#!/usr/bin/env node

/**
 * Generate a development JWT token for testing the MCP Manager.
 * 
 * Usage:
 *   node scripts/generate-dev-token.js                      # Admin token (default)
 *   node scripts/generate-dev-token.js --user my-user-id    # Custom user ID
 *   node scripts/generate-dev-token.js --role user          # User-level token
 *   node scripts/generate-dev-token.js --role viewer        # Viewer-level token
 *   node scripts/generate-dev-token.js --groups "consec-example-admin"  # With AD groups
 */

const crypto = require('crypto');

const args = process.argv.slice(2);
let userId = 'auth0|admin123';
let orgId = null;
let role = 'admin';
let customGroups = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user' && args[i + 1]) {
    userId = args[i + 1];
    i++;
  }
  if (args[i] === '--org' && args[i + 1]) {
    orgId = args[i + 1];
    i++;
  }
  if (args[i] === '--role' && args[i + 1]) {
    role = args[i + 1];
    i++;
  }
  if (args[i] === '--groups' && args[i + 1]) {
    customGroups = args[i + 1].split(',').map(g => g.trim());
    i++;
  }
}

// In dev mode, the services use a simple symmetric key
const DEV_JWT_SECRET = process.env.JWT_SECRET || process.env.DEV_JWT_SECRET;

if (!DEV_JWT_SECRET) {
  console.error('Error: JWT_SECRET or DEV_JWT_SECRET environment variable is required');
  console.error('Set it with: export JWT_SECRET="your-secret-here"');
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createDevToken(payload) {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 86400 * 365, // 1 year for dev tokens
    iss: 'mcp-manager', // Must match JWT_ISSUER in auth plugin
    aud: 'mcp-manager',
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(fullPayload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  
  const signature = crypto
    .createHmac('sha256', DEV_JWT_SECRET)
    .update(signatureInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Determine AD groups based on role
function getGroupsForRole(role) {
  switch (role) {
    case 'admin':
      return ['consec-example-admin'];
    case 'user':
      return ['consec-example-users'];
    case 'viewer':
      return []; // No groups = viewer
    default:
      return ['consec-example-admin'];
  }
}

// Determine permissions based on role
function getPermissionsForRole(role) {
  switch (role) {
    case 'admin':
      return [
        'servers:read', 'servers:write', 'servers:approve', 'servers:admin',
        'policies:read', 'policies:write',
        'audit:read',
        'teams:read', 'teams:write',
        'orgs:read', 'orgs:write',
        'users:read', 'users:write',
      ];
    case 'user':
      return [
        'servers:read', 'servers:write',
        'policies:read',
        'audit:read',
        'teams:read',
      ];
    case 'viewer':
      return ['servers:read', 'policies:read'];
    default:
      return ['servers:read'];
  }
}

const groups = customGroups || getGroupsForRole(role);
const permissions = getPermissionsForRole(role);

const token = createDevToken({
  sub: userId,
  org: orgId,
  email: role === 'admin' ? 'admin@example.com' : `${role}@example.com`,
  name: role === 'admin' ? 'Admin User' : `${role.charAt(0).toUpperCase() + role.slice(1)} User`,
  groups: groups,
  roles: [role],
  permissions: permissions,
});

console.log('\n🔐 Development JWT Token Generated\n');
console.log('User ID:', userId);
console.log('Role:', role);
console.log('AD Groups:', groups.length > 0 ? groups.join(', ') : '(none - viewer)');
console.log('Permissions:', permissions.join(', '));
if (orgId) console.log('Org ID:', orgId);
console.log('\nToken:');
console.log(token);
console.log('\nUsage:');
console.log(`  curl -H "Authorization: Bearer ${token.slice(0, 50)}..." http://localhost:3001/api/servers`);
console.log('\nExamples:');
console.log('  # Generate admin token (default)');
console.log('  node scripts/generate-dev-token.js');
console.log('');
console.log('  # Generate user token (limited permissions)');
console.log('  node scripts/generate-dev-token.js --role user');
console.log('');
console.log('  # Generate viewer token (read-only)');
console.log('  node scripts/generate-dev-token.js --role viewer');
console.log('');
console.log('Note: This token is for development only. In production, use Azure AD SSO.');
console.log('');
