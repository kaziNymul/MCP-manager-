# Active Directory SSO Configuration Guide

This guide explains how to configure Active Directory (AD) Single Sign-On for MCP Manager. Users log in directly with their corporate username and password - no redirect to external pages.

## Overview

MCP Manager authenticates users directly against your Active Directory via LDAP. When users log in:

1. They enter their corporate username and password on the MCP Manager login page
2. MCP Manager validates credentials against your AD Domain Controller via LDAP
3. AD returns user info + group memberships
4. MCP Manager grants permissions based on AD group membership

| AD Group | Role | Permissions |
|----------|------|-------------|
| `consec-example-admin` | ADMIN | Full access to all features |
| `consec-example-users` | MEMBER | Register/manage their own servers, view policies |
| (No group) | VIEWER | Read-only access |

## Login Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Manager Login Page                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Username: [john.doe________________]                    │    │
│  │  Password: [************************]                    │    │
│  │                                                          │    │
│  │  [        Sign In with Corporate Credentials        ]   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   LDAP Bind (Authentication)   │
              │   ldap://dc.example.com:389   │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Search for User Groups       │
              │   (memberOf attribute)         │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Map Groups to Permissions    │
              │   consec-example-admin → ADMIN │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Return JWT Token             │
              │   User logged in!              │
              └───────────────────────────────┘
```

## Prerequisites

1. Active Directory Domain Controller accessible from MCP Manager
2. LDAP port open (389 for LDAP, 636 for LDAPS)
3. AD groups created for admin and user access
4. Service account (optional, for advanced configurations)

---

## Step 1: Create AD Security Groups

### 1.1 Create Admin Group

1. Open **Active Directory Users and Computers**
2. Navigate to your OU (e.g., `OU=Groups,DC=example,DC=com`)
3. Right-click → **New** → **Group**
4. Configure:
   - **Group name**: `consec-example-admin`
   - **Group scope**: Global
   - **Group type**: Security
5. Click **OK**

### 1.2 Create User Group

1. Create another group:
   - **Group name**: `consec-example-users`
   - **Group scope**: Global
   - **Group type**: Security

### 1.3 Add Members

1. Open each group → **Members** tab → **Add**
2. Add appropriate users to each group

---

## Step 2: Configure MCP Manager

### 2.1 Environment Variables

Add these to your `.env` file or Kubernetes secrets:

```bash
# Authentication Mode - set to 'ldap' for Active Directory
AUTH_MODE=ldap

# LDAP Server Configuration
LDAP_URL=ldap://your-domain-controller.example.com:389
# For secure LDAP (recommended in production):
# LDAP_URL=ldaps://your-domain-controller.example.com:636
# LDAP_USE_TLS=true

# Active Directory Domain
AD_DOMAIN=EXAMPLE  # NetBIOS domain name (e.g., CONTOSO, CORP, EXAMPLE)

# Base DN for user search
LDAP_BASE_DN=DC=example,DC=com

# User search filter (default works for most AD setups)
LDAP_USER_SEARCH_FILTER=(sAMAccountName={{username}})

# JWT Configuration
JWT_SECRET=your-secure-random-string-minimum-32-characters
JWT_ISSUER=mcp-manager
JWT_AUDIENCE=mcp-manager

# AD Group Configuration (case-insensitive)
AD_ADMIN_GROUPS=consec-example-admin
AD_USER_GROUPS=consec-example-users

# Default organization for new users (JIT provisioning)
DEFAULT_ORG_SLUG=default
```

### 2.2 Username Formats Supported

Users can log in using any of these formats:

| Format | Example | Notes |
|--------|---------|-------|
| Plain username | `john.doe` | Domain prefix is added automatically |
| DOMAIN\username | `EXAMPLE\john.doe` | Traditional Windows format |
| UPN (email) | `john.doe@example.com` | User Principal Name |

### 2.3 Multiple Admin/User Groups

You can specify multiple groups (comma-separated):

```bash
AD_ADMIN_GROUPS=global-admins,security-team,mcp-admins
AD_USER_GROUPS=developers,engineering,devops,contractors
```

---

## Step 3: Network Configuration

### 3.1 Firewall Rules

Ensure MCP Manager can reach your Domain Controller:

| Source | Destination | Port | Protocol | Description |
|--------|-------------|------|----------|-------------|
| MCP Manager | Domain Controller | 389 | TCP | LDAP |
| MCP Manager | Domain Controller | 636 | TCP | LDAPS (secure) |
| MCP Manager | Domain Controller | 3268 | TCP | Global Catalog |

### 3.2 DNS Resolution

MCP Manager must be able to resolve the Domain Controller hostname:

```bash
# Test from MCP Manager container/server
nslookup your-domain-controller.example.com
```

### 3.3 Testing LDAP Connectivity

```bash
# Test LDAP connection (from MCP Manager server)
ldapsearch -x -H ldap://your-domain-controller.example.com:389 \
  -D "EXAMPLE\testuser" -W \
  -b "DC=example,DC=com" \
  "(sAMAccountName=testuser)"
```

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

### Viewer Permissions (No Group)

Read-only access to servers and policies only.

---

## Step 5: Just-In-Time (JIT) User Provisioning

When a user logs in for the first time:

1. MCP Manager validates credentials against AD
2. Retrieves user's AD groups (from `memberOf` attribute)
3. Creates user record in database with:
   - Email from AD (`mail` or `userPrincipalName`)
   - Display name from AD (`displayName`)
   - Role based on AD groups
4. User can immediately access the system

**No manual user creation required!**

---

## Troubleshooting

### "Invalid username or password"

1. **Verify credentials**: Test login with the same credentials in another AD-integrated app
2. **Check domain prefix**: Try logging in as `DOMAIN\username`
3. **Check LDAP URL**: Ensure the Domain Controller is reachable
4. **Check logs**: Look at control-plane logs for detailed error messages

```bash
docker logs mcp-manager-control-plane 2>&1 | grep -i ldap
```

### "LDAP connection failed"

1. **Check network**: Can you ping the Domain Controller?
2. **Check port**: Is port 389 (or 636) open?
3. **Check DNS**: Can you resolve the DC hostname?
4. **Check TLS**: If using LDAPS, ensure certificates are valid

### "User authenticated but no groups found"

This can happen if:
1. User is not in any groups
2. LDAP search permissions are restricted
3. Group search base DN is incorrect

Try setting `LDAP_BASE_DN` to a broader scope:

```bash
LDAP_BASE_DN=DC=example,DC=com
```

### "Permission denied" for admin users

1. Verify user is actually in the admin AD group
2. Check `AD_ADMIN_GROUPS` spelling (case-insensitive)
3. Ensure group name matches exactly (check for trailing spaces)

---

## Security Best Practices

### 1. Use LDAPS (Secure LDAP)

```bash
LDAP_URL=ldaps://your-domain-controller.example.com:636
LDAP_USE_TLS=true
```

### 2. Least Privilege

Only add users to `consec-example-admin` if they truly need admin access.

### 3. Strong JWT Secret

Generate a secure random secret:

```bash
openssl rand -base64 32
```

### 4. Session Timeout

Sessions expire after 8 hours by default. Users must re-authenticate with their AD credentials.

### 5. Audit Logging

All login attempts are logged with timestamps and IP addresses.

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
  AUTH_MODE: "ldap"
  LDAP_URL: "ldaps://dc01.corp.example.com:636"
  LDAP_USE_TLS: "true"
  AD_DOMAIN: "CORP"
  LDAP_BASE_DN: "DC=corp,DC=example,DC=com"
  LDAP_USER_SEARCH_FILTER: "(sAMAccountName={{username}})"
  AD_ADMIN_GROUPS: "MCP-Admins,Security-Team"
  AD_USER_GROUPS: "MCP-Users,Developers,DevOps"
  JWT_SECRET: "your-secure-random-string-here"
  DEFAULT_ORG_SLUG: "corp"
```

---

## Development Mode

When `AUTH_MODE=development` (default), you can:

1. **Use the login form** with any username (e.g., "admin" or "user")
2. **Use quick login buttons** for Admin or User roles
3. No actual AD connection is made

This allows development and testing without AD access.

---

## Comparison: LDAP vs OAuth/OIDC

| Feature | LDAP (Current) | OAuth/OIDC |
|---------|---------------|------------|
| Login experience | Direct form on MCP Manager | Redirect to Microsoft/IdP |
| Password handling | Sent to backend, then to AD | Never seen by app |
| Network requirement | Direct access to DC | Internet access to IdP |
| MFA support | Depends on AD config | Full support |
| Setup complexity | Lower | Higher |

MCP Manager uses **LDAP** for direct login without redirects, as requested.
