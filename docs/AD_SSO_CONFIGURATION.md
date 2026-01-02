# Azure AD SSO Configuration Guide

This guide explains how to configure Azure Active Directory (AD) Single Sign-On (SSO) for MCP Manager. Users log in with their corporate credentials (username/password), and their access level is determined by AD group membership.

## Overview

MCP Manager supports enterprise SSO authentication via Azure AD (or other OIDC-compatible providers like Okta, AWS Cognito). When users log in:

1. They click "Sign in with Microsoft" on the login page
2. They're redirected to Microsoft's login page to enter their corporate credentials
3. After successful authentication, Azure AD returns user info + group memberships
4. MCP Manager grants permissions based on AD group membership

| AD Group | Role | Permissions |
|----------|------|-------------|
| `consec-example-admin` | ADMIN | Full access to all features |
| `consec-example-users` | MEMBER | Register/manage their own servers, view policies |
| (No group) | VIEWER | Read-only access |

## Prerequisites

1. Azure AD tenant with Global Administrator access
2. MCP Manager deployed (or running locally for testing)
3. SSL/TLS enabled for production deployments

---

## Step 1: Register Application in Azure AD

### 1.1 Create App Registration

1. Go to **Azure Portal** → **Azure Active Directory** → **App registrations**
2. Click **New registration**
3. Configure:
   - **Name**: `MCP Manager`
   - **Supported account types**: Choose based on your org (typically "Single tenant")
   - **Redirect URI**: 
     - Type: `Web`
     - URI: `https://your-domain.com/api/auth/callback` (or `http://localhost:3000/api/auth/callback` for local dev)
4. Click **Register**

### 1.2 Note Important Values

After registration, note these values:

```
Application (client) ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
Directory (tenant) ID: yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
```

### 1.3 Create Client Secret

1. Go to **Certificates & secrets** → **Client secrets** → **New client secret**
2. Add description: `MCP Manager Secret`
3. Set expiration (recommend 24 months for production)
4. **Copy the secret value immediately** - you won't see it again!

---

## Step 2: Configure AD Groups

### 2.1 Create Security Groups

1. Go to **Azure AD** → **Groups** → **New group**
2. Create admin group:
   - **Group type**: Security
   - **Group name**: `consec-example-admin`
   - **Description**: MCP Manager Administrators - Full access
   - **Membership type**: Assigned
3. Create user group:
   - **Group type**: Security  
   - **Group name**: `consec-example-users`
   - **Description**: MCP Manager Users - Can register and manage own servers
   - **Membership type**: Assigned

### 2.2 Assign Users to Groups

1. Open each group → **Members** → **Add members**
2. Add appropriate users to each group

### 2.3 Enable Group Claims in Token

1. Go to **App registrations** → **MCP Manager** → **Token configuration**
2. Click **Add groups claim**
3. Select:
   - ✅ Security groups
   - ✅ Groups assigned to the application (optional, for filtered groups)
4. For **ID** token and **Access** token, select:
   - **Emit groups as role claims**: `sAMAccountName` or `Group ID`
5. Click **Add**

### 2.4 (Optional) Assign Groups to App

For large organizations, limit which groups can access the app:

1. Go to **Enterprise applications** → **MCP Manager**
2. Click **Users and groups** → **Add user/group**
3. Add both `consec-example-admin` and `consec-example-users` groups

---

## Step 3: Configure MCP Manager

### 3.1 Environment Variables

Add these to your `.env` or Kubernetes secrets:

```bash
# Authentication Mode (set to 'oidc' for Azure AD)
AUTH_MODE=oidc

# Azure AD OAuth Configuration
AZURE_AD_TENANT_ID=your-tenant-id-here
AZURE_AD_CLIENT_ID=your-client-id-here
AZURE_AD_CLIENT_SECRET=your-client-secret-here

# OAuth Redirect URI (must match what you configured in Azure AD)
REDIRECT_URI=https://your-domain.com/api/auth/callback

# Frontend URL (for post-login redirect)
FRONTEND_URL=https://your-domain.com

# JWT Configuration (for session tokens)
JWT_SECRET=your-secure-random-string-here
JWT_ISSUER=mcp-manager
JWT_AUDIENCE=mcp-manager

# AD Group Configuration
AD_ADMIN_GROUPS=consec-example-admin
AD_USER_GROUPS=consec-example-users
AD_GROUPS_OVERRIDE=true

# JIT Provisioning (creates users on first login)
DEFAULT_ORG_SLUG=default
```

Replace:
- `your-tenant-id-here` with your Azure AD tenant ID
- `your-client-id-here` with your app registration's client ID
- `your-client-secret-here` with the secret you created in Step 1.3
- `your-domain.com` with your actual domain

### 3.2 Multiple Admin/User Groups

You can specify multiple groups (comma-separated):

```bash
AD_ADMIN_GROUPS=global-admins,security-team,mcp-admins
AD_USER_GROUPS=developers,engineering,devops
```

### 3.3 AD Groups Override Behavior

- `AD_GROUPS_OVERRIDE=true` - Roles from AD groups take precedence over database roles
- `AD_GROUPS_OVERRIDE=false` - Database roles take precedence (AD groups still tracked)

---

## Step 4: Permission Matrix

### Admin Permissions (`consec-example-admin`)

| Resource | Create | Read | Update | Delete | Approve |
|----------|--------|------|--------|--------|---------|
| Servers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Policies | ✅ | ✅ | ✅ | ✅ | - |
| Teams | ✅ | ✅ | ✅ | ✅ | - |
| Audit Logs | - | ✅ | - | - | - |
| Organizations | ✅ | ✅ | ✅ | ✅ | - |
| Users | ✅ | ✅ | ✅ | ✅ | - |

### User Permissions (`consec-example-users`)

| Resource | Create | Read | Update | Delete | Approve |
|----------|--------|------|--------|--------|---------|
| Servers (own) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Servers (others) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Policies | ❌ | ✅ | ❌ | ❌ | - |
| Teams | ❌ | ✅ | ❌ | ❌ | - |
| Audit Logs | - | ✅ | - | - | - |
| Organizations | ❌ | ❌ | ❌ | ❌ | - |
| Users | ❌ | ❌ | ❌ | ❌ | - |

### Viewer Permissions (No Group)

Read-only access to servers and policies only.

---

## Step 5: Testing

### 5.1 Get Test Token (Development)

For development/testing, generate a token with group claims:

```javascript
// scripts/generate-ad-token.js
const jose = require('jose');

async function generateTestToken() {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  
  const token = await new jose.SignJWT({
    sub: 'test-user-001',
    email: 'admin@example.com',
    name: 'Test Admin',
    groups: ['consec-example-admin'], // Or ['consec-example-users']
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('mcp-manager')
    .setAudience('mcp-manager')
    .setExpirationTime('1h')
    .sign(secret);

  console.log('Bearer', token);
}

generateTestToken();
```

### 5.2 Verify Authentication

```bash
# Test with admin token
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/servers

# Test server approval (admin only)
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"approved": true}' \
  http://localhost:3001/api/servers/{id}/versions/{versionId}/approve

# Test with user token (should fail for approval)
curl -X POST \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"approved": true}' \
  http://localhost:3001/api/servers/{id}/versions/{versionId}/approve
# Expected: 403 Forbidden
```

---

## Step 6: Just-In-Time User Provisioning

When a user authenticates for the first time:

1. MCP Manager validates the JWT token
2. Extracts AD group membership from token claims
3. If user doesn't exist in database:
   - Creates new user with email and name from token
   - Assigns role based on AD groups
   - Associates with default organization
4. User can immediately use the system

This eliminates manual user provisioning.

---

## Troubleshooting

### "User not found" after successful AD login

Check that JIT provisioning is configured:
```bash
DEFAULT_ORG_SLUG=your-org-slug
```

### Groups not appearing in token

1. Verify group claims are configured in **Token configuration**
2. Check if groups are assigned to the app in **Enterprise applications**
3. For large numbers of groups, Azure may return group IDs instead of names - configure group ID in `AD_ADMIN_GROUPS`

### "Invalid issuer" error

Ensure `JWT_ISSUER` matches the issuer in your tokens:
- Azure AD v2: `https://login.microsoftonline.com/{tenant-id}/v2.0`
- Azure AD v1: `https://sts.windows.net/{tenant-id}/`

### Permission denied for admin users

1. Verify `AD_GROUPS_OVERRIDE=true` is set
2. Check group name spelling in `AD_ADMIN_GROUPS`
3. Verify user is actually in the admin group in Azure AD

---

## Security Best Practices

1. **Use Group IDs**: In production, use Azure AD Group Object IDs instead of display names (they're immutable)

2. **Token Validation**: Always verify tokens with Azure AD's public keys (JWKS)

3. **Least Privilege**: Only assign users to `consec-example-admin` if they truly need admin access

4. **Audit Logging**: Monitor audit logs for unusual admin activity

5. **Session Management**: Configure appropriate token lifetimes in Azure AD

6. **Conditional Access**: Use Azure AD Conditional Access policies for additional security

---

## Example: Complete Production Configuration

```yaml
# k8s/overlays/production/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: mcp-manager-secrets
  namespace: mcp-manager
type: Opaque
stringData:
  AUTH_MODE: "oidc"
  JWKS_URI: "https://login.microsoftonline.com/your-tenant-id/discovery/v2.0/keys"
  JWT_ISSUER: "https://login.microsoftonline.com/your-tenant-id/v2.0"
  JWT_AUDIENCE: "your-app-client-id"
  AD_ADMIN_GROUPS: "12345678-1234-1234-1234-123456789abc"
  AD_USER_GROUPS: "87654321-4321-4321-4321-cba987654321"
  AD_GROUPS_OVERRIDE: "true"
  DEFAULT_ORG_SLUG: "your-company"
```

---

## Support for Other Identity Providers

### Okta

```bash
JWKS_URI=https://your-org.okta.com/oauth2/default/v1/keys
JWT_ISSUER=https://your-org.okta.com/oauth2/default
AD_ADMIN_GROUPS=mcp-admins
AD_USER_GROUPS=mcp-users
```

Groups come from the `groups` claim (configure in Okta app settings).

### AWS Cognito

```bash
JWKS_URI=https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json
JWT_ISSUER=https://cognito-idp.{region}.amazonaws.com/{userPoolId}
```

Groups come from the `cognito:groups` claim.

### Keycloak

```bash
JWKS_URI=https://keycloak.example.com/realms/{realm}/protocol/openid-connect/certs
JWT_ISSUER=https://keycloak.example.com/realms/{realm}
```

Groups/roles come from the `roles` or `groups` claim.
