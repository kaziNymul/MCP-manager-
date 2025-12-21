# Source Code Scanning - Repository Access Permissions

MCP Manager supports scanning the **source code** of MCP servers for security vulnerabilities,
hardcoded secrets, and dangerous patterns. This requires read access to the repository.

---

## Overview

Source code scanning provides **deeper security analysis** than API introspection alone:

| Scan Type | What It Checks | Access Required |
|-----------|---------------|-----------------|
| **API Introspection** | Tool names, schemas, descriptions | MCP server endpoint (URL) |
| **Source Code Scan** | Actual code vulnerabilities, secrets, patterns | Repository read access |
| **Dependency Scan** | Known CVEs in packages | Repository read access |

---

## Repository Providers & Required Permissions

### GitHub

**Token Types:**
1. **Personal Access Token (Classic)** - Recommended for simplicity
2. **Fine-grained Token** - Better for security (scoped to specific repos)

**Required Scopes:**

| Token Type | Scope | Description |
|------------|-------|-------------|
| Classic PAT | `repo` | Full control of private repositories |
| Classic PAT | `public_repo` | Access public repositories only |
| Fine-grained | `contents: read` | Read repository contents |

**Setup Steps:**

```
1. Go to: https://github.com/settings/tokens
2. Click "Generate new token" → "Personal access token (classic)"
3. Set expiration (recommended: 90 days)
4. Select scope:
   - For private repos: ✅ repo
   - For public repos only: ✅ public_repo
5. Click "Generate token"
6. Copy the token (starts with ghp_)
```

**For GitHub Enterprise Server:**
```
1. Go to: https://github.YOUR-COMPANY.com/settings/tokens
2. Same steps as above
3. Set GITHUB_API_URL in MCP Manager:
   GITHUB_API_URL=https://github.YOUR-COMPANY.com/api/v3
```

**Environment Variable:**
```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

---

### GitLab

**Token Type:** Personal Access Token

**Required Scope:**
- `read_repository` - Grants read access to repository contents

**Setup Steps:**

```
1. Go to: https://gitlab.com/-/user_settings/personal_access_tokens
2. Enter token name (e.g., "MCP Manager Scanner")
3. Set expiration date (recommended: 90 days)
4. Select scope:
   ✅ read_repository
5. Click "Create personal access token"
6. Copy the token (starts with glpat-)
```

**For Self-Hosted GitLab:**
```
1. Go to: https://gitlab.YOUR-COMPANY.com/-/profile/personal_access_tokens
2. Same steps as above
3. Set GITLAB_URL in MCP Manager (if needed)
```

**Environment Variable:**
```bash
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
```

---

### Bitbucket

**Token Type:** App Password

**Required Permission:**
- `Repositories: Read` - Read access to repository contents

**Setup Steps:**

```
1. Go to: https://bitbucket.org/account/settings/app-passwords/
2. Click "Create app password"
3. Enter label (e.g., "MCP Manager Scanner")
4. Select permissions:
   ✅ Repositories: Read
5. Click "Create"
6. Copy the password
```

**Authentication Format:**
Bitbucket uses Basic Auth with app passwords:
```
username:app_password
```

**Environment Variable:**
```bash
BITBUCKET_TOKEN=your-app-password
BITBUCKET_USERNAME=your-username
```

---

### Azure DevOps

**Token Type:** Personal Access Token (PAT)

**Required Scope:**
- `Code (Read)` - Read source code and metadata

**Setup Steps:**

```
1. Go to: https://dev.azure.com/{organization}/_usersSettings/tokens
2. Click "New Token"
3. Enter name (e.g., "MCP Manager Scanner")
4. Set expiration (recommended: 90 days)
5. Select scope:
   ✅ Code → Read
6. Click "Create"
7. Copy the token
```

**Environment Variable:**
```bash
AZURE_DEVOPS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Security Best Practices

### Token Permissions

**Principle of Least Privilege:**
- Use **read-only** tokens
- Scope to **specific repositories** when possible
- Set **short expiration** (90 days or less)
- **Rotate tokens** regularly

**What MCP Manager Does:**
```
✅ Reads source code files
✅ Reads package manifests (package.json, requirements.txt)
✅ Lists directory contents

❌ NEVER writes to repositories
❌ NEVER modifies any files
❌ NEVER creates branches or commits
❌ NEVER accesses other resources (issues, PRs, etc.)
```

### Token Storage

**In Production (Kubernetes):**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: source-code-scanner-secrets
  namespace: mcp-manager
type: Opaque
stringData:
  REPOSITORY_ACCESS_TOKEN: "ghp_xxxxxxxxxxxxxxxx"
```

**Using External Secrets Operator:**

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: scanner-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: source-code-scanner-secrets
  data:
    - secretKey: REPOSITORY_ACCESS_TOKEN
      remoteRef:
        key: secret/mcp-manager/scanner
        property: github_token
```

### Per-Server Tokens

For organizations with strict access control, you can provide tokens **per server** instead of a global token:

```typescript
// When triggering a scan via API:
POST /api/servers/:id/scan/source-code
{
  "repositoryToken": "ghp_server_specific_token"
}
```

This allows:
- Different teams to provide their own tokens
- Fine-grained access control per repository
- Token rotation without affecting other servers

---

## What Gets Scanned

### Source Code Analysis

MCP Manager scans for:

| Category | Examples | Severity |
|----------|----------|----------|
| **Command Injection** | `child_process.exec(userInput)` | CRITICAL |
| **SQL Injection** | `query("SELECT * " + userInput)` | CRITICAL |
| **Code Injection** | `eval(userInput)` | CRITICAL |
| **Path Traversal** | `readFile(userPath)` | HIGH |
| **SSRF** | `fetch(userUrl)` | HIGH |
| **Hardcoded Secrets** | `apiKey = "sk-..."` | CRITICAL |
| **Insecure Crypto** | `crypto.createCipher('des', ...)` | HIGH |
| **Insecure Random** | `Math.random()` for tokens | HIGH |

### Secret Detection

Detects hardcoded credentials:

| Secret Type | Pattern | Severity |
|-------------|---------|----------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` | CRITICAL |
| GitHub Token | `ghp_[A-Za-z0-9]{36}` | CRITICAL |
| GitLab Token | `glpat-[A-Za-z0-9-]{20,}` | CRITICAL |
| OpenAI API Key | `sk-[A-Za-z0-9]{32,}` | CRITICAL |
| Private Key | `-----BEGIN PRIVATE KEY-----` | CRITICAL |
| Database URL | `postgres://user:pass@host` | CRITICAL |
| Generic Password | `password = "..."` | HIGH |

### Dependency Scanning

Checks package manifests for known vulnerabilities:

- `package.json` / `package-lock.json` (npm)
- `requirements.txt` / `Pipfile` (Python)
- `go.mod` (Go)
- `Cargo.toml` (Rust)
- `pom.xml` / `build.gradle` (Java)
- `*.csproj` (C#/.NET)

---

## API Reference

### Trigger Source Code Scan

```bash
POST /api/servers/:id/scan/source-code
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "repositoryToken": "ghp_optional_token"  # Optional, uses env var if not provided
}
```

**Response (202 Accepted):**
```json
{
  "message": "Source code scan started",
  "scanJobId": "scan_xyz123",
  "status": "RUNNING"
}
```

### Get Scan Results

```bash
GET /api/servers/:id/scan/source-code
Authorization: Bearer <token>
```

**Response:**
```json
{
  "repositoryUrl": "https://github.com/org/repo",
  "repositoryBranch": "main",
  "repositoryProvider": "GITHUB",
  "sourceCodeScanEnabled": true,
  "scanJobs": [
    {
      "id": "scan_xyz123",
      "status": "COMPLETED",
      "scanType": "SOURCE_CODE",
      "startedAt": "2024-12-21T10:00:00Z",
      "completedAt": "2024-12-21T10:02:30Z",
      "filesScanned": 156,
      "linesScanned": 12450,
      "vulnerabilityCounts": {
        "critical": 2,
        "high": 5,
        "medium": 12,
        "low": 8,
        "info": 3,
        "total": 30
      }
    }
  ],
  "latestScan": {
    "id": "scan_xyz123",
    "vulnerabilities": [
      {
        "type": "SQL_INJECTION",
        "severity": "CRITICAL",
        "title": "SQL Injection via String Interpolation",
        "file": "src/db.ts",
        "line": 45,
        "code": "query(`SELECT * FROM ${table}...`)",
        "cwe": "CWE-89",
        "remediation": "Use parameterized queries..."
      }
    ]
  }
}
```

### Get Permission Requirements

```bash
GET /api/servers/scan/source-code/requirements?provider=github
Authorization: Bearer <token>
```

**Response:**
```json
{
  "tokenName": "Personal Access Token (Classic) or Fine-grained Token",
  "requiredScopes": ["repo (full control)", "or contents:read for fine-grained"],
  "setupUrl": "https://github.com/settings/tokens",
  "instructions": "1. Go to GitHub Settings → Developer settings..."
}
```

---

## Troubleshooting

### Common Errors

**1. "Repository access token required"**
```
Solution: Provide a token via:
- Environment variable: REPOSITORY_ACCESS_TOKEN
- Per-scan request body: { "repositoryToken": "..." }
```

**2. "Failed to fetch file: 404"**
```
Possible causes:
- Repository URL is incorrect
- Branch name is wrong
- Path within repository is invalid
- Token doesn't have access to this repository
```

**3. "Failed to fetch file: 401"**
```
Possible causes:
- Token is expired
- Token is invalid
- Token doesn't have required permissions
```

**4. "Failed to list files: 403"**
```
Possible causes:
- Rate limit exceeded
- Token doesn't have required scopes
- Repository access is restricted
```

### Rate Limits

| Provider | Rate Limit | Notes |
|----------|-----------|-------|
| GitHub | 5,000/hour (authenticated) | Higher for GitHub Enterprise |
| GitLab | 2,000/hour | Can be configured on self-hosted |
| Bitbucket | 1,000/hour | Per app password |
| Azure DevOps | 200/minute | Per user |

For large repositories, consider:
- Scanning specific paths only (`repositoryPath: "/src"`)
- Scheduling scans during off-peak hours
- Using a dedicated service account token

---

## Complete Setup Example

### 1. Create Token

```bash
# GitHub: Create PAT with repo scope
# GitLab: Create PAT with read_repository scope
# Bitbucket: Create App Password with Repositories:Read
```

### 2. Configure MCP Manager

```bash
# In .env or Kubernetes secret:
REPOSITORY_ACCESS_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

### 3. Register Server with Repository

```bash
POST /api/servers
{
  "name": "my-database-mcp",
  "displayName": "Database MCP",
  "endpoint": "https://mcp-db.internal:3040",
  "repositoryUrl": "https://github.com/myorg/database-mcp",
  "repositoryBranch": "main",
  "repositoryProvider": "GITHUB",
  "repositoryPath": "/",
  "sourceCodeScanEnabled": true
}
```

### 4. Trigger Scan

```bash
POST /api/servers/:id/scan/source-code
```

### 5. View Results

```bash
GET /api/servers/:id/scan/source-code
```

---

## Summary

| Provider | Token Type | Required Scope | Setup URL |
|----------|-----------|----------------|-----------|
| GitHub | PAT (Classic/Fine-grained) | `repo` or `contents:read` | github.com/settings/tokens |
| GitLab | Personal Access Token | `read_repository` | gitlab.com/-/profile/personal_access_tokens |
| Bitbucket | App Password | `Repositories: Read` | bitbucket.org/account/settings/app-passwords |
| Azure DevOps | PAT | `Code (Read)` | dev.azure.com/{org}/_usersSettings/tokens |

**Key Points:**
- ✅ Use **read-only** tokens
- ✅ Scope to **specific repos** when possible
- ✅ Set **short expiration** dates
- ✅ Store tokens in **secrets management**
- ✅ Rotate tokens **regularly**
