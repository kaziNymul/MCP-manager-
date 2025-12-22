#!/usr/bin/env node

/**
 * Generate a development JWT token for testing the MCP Manager.
 * 
 * Usage:
 *   node scripts/generate-dev-token.js
 *   node scripts/generate-dev-token.js --user my-user-id
 */

const crypto = require('crypto');

const args = process.argv.slice(2);
let userId = 'auth0|admin123';
let orgId = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user' && args[i + 1]) {
    userId = args[i + 1];
    i++;
  }
  if (args[i] === '--org' && args[i + 1]) {
    orgId = args[i + 1];
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
    iss: 'mcp-manager-dev',
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

const token = createDevToken({
  sub: userId,
  org: orgId,
  roles: ['admin'],
  permissions: [
    'servers:read',
    'servers:write',
    'servers:approve',
    'policies:read',
    'policies:write',
    'audit:read',
    'teams:read',
    'teams:write',
    'orgs:read',
    'orgs:write',
  ],
});

console.log('\n🔐 Development JWT Token Generated\n');
console.log('User ID:', userId);
if (orgId) console.log('Org ID:', orgId);
console.log('\nToken:');
console.log(token);
console.log('\nUsage:');
console.log(`  curl -H "Authorization: Bearer ${token.slice(0, 50)}..." http://localhost:3001/api/servers`);
console.log('\nNote: This token is for development only. In production, use a proper OIDC provider.');
console.log('');
