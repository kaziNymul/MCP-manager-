# MCP Manager - Complete Functionality Guide

**Enterprise-grade SaaS for MCP (Model Context Protocol) Governance, Security Scanning, Approval Workflows, and Runtime Enforcement**

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Architecture](#2-system-architecture)
3. [Core Components](#3-core-components)
4. [Security Scanning Pipeline](#4-security-scanning-pipeline)
5. [Policy Engine](#5-policy-engine)
6. [Runtime Traffic Enforcement](#6-runtime-traffic-enforcement)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Audit Logging](#8-audit-logging)
9. [GitHub Copilot Integration](#9-github-copilot-integration)
10. [API Reference](#10-api-reference)
11. [Database Schema](#11-database-schema)
12. [Deployment Architecture](#12-deployment-architecture)
13. [Configuration](#13-configuration)

---

## 1. Overview

### What is MCP Manager?

MCP Manager is an enterprise governance layer for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. It provides a complete solution for organizations to:

| Capability | Description |
|------------|-------------|
| **Register & Approve** | MCP servers go through approval workflow before developers can use them |
| **Scan for Vulnerabilities** | Automatic detection of dangerous tool patterns, code vulnerabilities, and secrets |
| **Enforce Policies** | Fine-grained control over which tools each team can access |
| **Monitor Usage** | Complete audit trail of all MCP operations |
| **Block Threats** | Real-time threat detection and blocking of malicious traffic |
| **Sync with GitHub Copilot** | Automatic synchronization with enterprise allowlists |

### Key Value Propositions

1. **Zero Trust MCP**: No server is trusted by default - all must be scanned and approved
2. **Defense in Depth**: Multiple layers of security (registration, runtime, response scanning)
3. **Centralized Control**: Single pane of glass for all MCP server governance
4. **Enterprise Ready**: Multi-tenant, team-based access, comprehensive audit logs
5. **GitHub Copilot Native**: Built-in integration with GitHub Enterprise Copilot

---

## 2. System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL CLIENTS                                   │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                        │
│  │ GitHub      │   │ IDE/Editor  │   │ CLI Tools   │                        │
│  │ Copilot     │   │ (VS Code)   │   │             │                        │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘                        │
└─────────┼─────────────────┼─────────────────┼───────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MCP MANAGER PLATFORM                                 │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      CONTROL PLANE                                   │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐           │   │
│  │  │   Admin UI    │  │ Control Plane │  │   Scanner     │           │   │
│  │  │   (Next.js)   │  │   (Fastify)   │  │   Worker      │           │   │
│  │  │   Port 3000   │  │   Port 3001   │  │   Port 3004   │           │   │
│  │  └───────────────┘  └───────────────┘  └───────────────┘           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       DATA PLANE                                     │   │
│  │  ┌───────────────────────┐  ┌───────────────────────┐               │   │
│  │  │       Registry        │  │       Gateway         │               │   │
│  │  │    (Discovery-Time)   │  │   (Runtime Traffic)   │               │   │
│  │  │      Port 3002        │  │      Port 3003        │               │   │
│  │  └───────────────────────┘  └───────────────────────┘               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     SECURITY LAYER                                   │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │  │ Threat   │ │ Anomaly  │ │ Policy   │ │ Vuln     │ │ Source   │  │   │
│  │  │ Detector │ │ Detector │ │ Engine   │ │ Scanner  │ │ Scanner  │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      DATA STORES                                     │   │
│  │  ┌───────────────────────┐  ┌───────────────────────┐               │   │
│  │  │     PostgreSQL        │  │        Redis          │               │   │
│  │  │   (Prisma ORM)        │  │   (Cache/Sessions)    │               │   │
│  │  └───────────────────────┘  └───────────────────────┘               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND MCP SERVERS                                   │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                        │
│  │ MCP Server 1│   │ MCP Server 2│   │ MCP Server 3│                        │
│  │ (Internal)  │   │ (Internal)  │   │ (External)  │                        │
│  └─────────────┘   └─────────────┘   └─────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Traffic Flow: How Interception Works

```
Phase 1: Server Registration & Approval
=========================================
1. User registers MCP Server via Admin UI
2. Control Plane creates Server record (status: PENDING)
3. Scanner Worker picks up scan job
4. Scanner connects to MCP server, calls tools/list
5. Scanner analyzes tool schemas, computes risk score
6. If Risk ≤ 30: Auto-approve ✅
   If Risk > 30: Pending review ⏳

Phase 2: Discovery (Registry)
=============================
1. GitHub Copilot calls GET /v0.1/servers
2. Registry queries approved servers from database
3. Registry returns Gateway URLs (NOT real endpoints!)

Phase 3: Runtime Traffic (Gateway)
==================================
1. Copilot sends MCP request to Gateway
2. Gateway authenticates user
3. Gateway runs security checks:
   - Anomaly detection
   - Threat detection
   - Dangerous tool blocking
   - Policy evaluation
4. If ALL checks pass: Proxy to real server
5. Scan response for credential leaks
6. Log everything to audit trail
7. Return response to client
```

---

## 3. Core Components

### 3.1 Admin UI (Port 3000)

**Technology**: Next.js 14 with App Router, React, SWR

**Purpose**: Web dashboard for administrators to manage MCP servers, policies, teams, and view audit logs.

**Features**:
- Dashboard with security overview and statistics
- Server registration and management
- Policy creation and management
- Team management with access controls
- Audit log viewer with filtering
- Security scanner results display
- Active Directory SSO login (LDAP)

**Key Pages**:
| Route | Description |
|-------|-------------|
| `/` | Dashboard with metrics |
| `/servers` | List and manage MCP servers |
| `/servers/[id]` | Server details and versions |
| `/policies` | Policy management |
| `/teams` | Team management |
| `/audit` | Audit log viewer |
| `/security` | Security overview |
| `/login` | LDAP authentication |

### 3.2 Control Plane API (Port 3001)

**Technology**: Fastify (Node.js), TypeScript

**Purpose**: REST API for administrative operations. Handles server registration, approval workflows, policy management, and team management.

**Key Endpoints**:
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers` | List MCP servers |
| POST | `/api/servers` | Register new server |
| GET | `/api/servers/:id` | Get server details |
| POST | `/api/servers/:id/approve` | Approve server version |
| POST | `/api/servers/:id/revoke` | Revoke server |
| GET | `/api/policies` | List policies |
| POST | `/api/policies` | Create policy |
| GET | `/api/teams` | List teams |
| POST | `/api/teams` | Create team |
| GET | `/api/audit` | Query audit logs |
| GET | `/api/audit/stats` | Get audit statistics |
| POST | `/api/auth/login` | LDAP authentication |

### 3.3 Registry Service (Port 3002)

**Technology**: Fastify (Node.js), TypeScript

**Purpose**: Discovery-time service implementing the official MCP Registry v0.1 specification. GitHub Copilot and other MCP clients query this to discover approved servers.

**Key Behavior**:
- Returns **Gateway URLs**, not real server endpoints
- Only lists APPROVED servers
- Implements official MCP Registry API specification
- Supports organization-based filtering

**Endpoints**:
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v0.1/servers` | List all approved MCP servers |
| GET | `/v0.1/servers/{name}/versions/latest` | Get latest version |
| GET | `/v0.1/servers/{name}/versions/{version}` | Get specific version |
| GET | `/v0.1/health` | Health check |
| GET | `/v0.1/ping` | Ping |
| GET | `/v0.1/version` | Version info |

### 3.4 Gateway Service (Port 3003)

**Technology**: Fastify (Node.js), TypeScript

**Purpose**: Runtime proxy for all MCP traffic. THE most critical security component.

**Key Responsibilities**:
1. **Authentication**: Validate JWT tokens
2. **Server Resolution**: Map org/server slug to approved backend
3. **Security Checks**: Run threat detection, anomaly detection, policy evaluation
4. **Request Proxying**: Forward allowed requests to real MCP servers
5. **Response Scanning**: Check responses for credential leaks
6. **Audit Logging**: Log all operations with full context

**Security Checks (in order)**:
```
Request → Auth → Anomaly Detection → Threat Detection → Policy Check → Proxy → Response Scan → Audit Log
                    ↓                      ↓                   ↓
                 [BLOCK]              [BLOCK]              [BLOCK]
```

### 3.5 Scanner Worker (Port 3004)

**Technology**: Node.js Worker, TypeScript

**Purpose**: Background service that scans MCP servers for vulnerabilities.

**Scanning Phases**:
1. **Tool Introspection**: Connect to server, call `tools/list`
2. **Schema Analysis**: Analyze each tool's input schema
3. **Vulnerability Detection**: Check for dangerous patterns
4. **Risk Scoring**: Compute 0-100 risk score
5. **Auto-Approval**: Auto-approve if score ≤ 30

---

## 4. Security Scanning Pipeline

MCP Manager implements a **two-level security scanning** approach:

### 4.1 Registration-Time Scanning (Static Analysis)

**When**: When a new MCP server is registered

**What's Scanned**:

| Check | Description |
|-------|-------------|
| **Tool Names** | Detect dangerous patterns: `execute`, `shell`, `eval`, `sql_exec` |
| **Tool Schemas** | Analyze input schemas for missing validation |
| **Endpoint Security** | Check for HTTPS, internal IPs, metadata endpoints |
| **Capabilities** | Identify capabilities: read, write, delete, network, exec |

**Dangerous Tool Patterns**:
```javascript
// Critical severity patterns
/^(execute|exec|run|shell|bash|sh|cmd|command|system|spawn|popen)/i
/eval|compile|interpret/i
/^(sql|query|database|db)_?(exec|execute|run|query)?/i

// High severity patterns
/^(write|create|delete|remove|unlink|rmdir|mkdir|move|copy|rename)_?(file|dir|folder|path)?/i
/^(http|fetch|request|curl|wget|download|upload|send|post|get)/i
/^(kill|terminate|signal|process|fork|spawn)/i
```

### 4.2 Source Code Scanning (Optional)

**When**: If repository URL is configured for the server

**Supported Providers**:
- GitHub (github.com, GitHub Enterprise)
- GitLab (gitlab.com, self-hosted)
- Bitbucket (bitbucket.org, Bitbucket Server)
- Azure DevOps

**What's Scanned**:

| Category | Checks |
|----------|--------|
| **Command Injection** | Shell execution, subprocess calls with user input |
| **SQL Injection** | Dynamic query construction |
| **Code Injection** | eval(), exec(), dynamic code execution |
| **Path Traversal** | File path manipulation |
| **SSRF** | URL/IP manipulation |
| **Hardcoded Secrets** | API keys, passwords, tokens |
| **Insecure Crypto** | Weak algorithms, insecure random |
| **Dependencies** | Known CVEs in dependencies |

**Secret Detection Patterns**:
```javascript
// API Keys
/\bsk-[a-zA-Z0-9]{32,}/g                    // OpenAI API Key
/\bghp_[a-zA-Z0-9]{36}/g                    // GitHub Token
/\bglpat-[a-zA-Z0-9\-_]{20,}/g              // GitLab Token
/\bxox[baprs]-[a-zA-Z0-9-]{10,}/g           // Slack Token
/\bAKIA[A-Z0-9]{16}/g                       // AWS Access Key

// Credentials
/-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g  // Private Keys
/(mongodb|postgres|mysql|redis):\/\/[^\s]+/gi // Connection Strings
```

### 4.3 Runtime Scanning (Real-Time)

**When**: Every MCP request through the Gateway

**Threat Detection**:

| Threat Type | Description |
|-------------|-------------|
| **Prompt Injection** | "ignore previous instructions", role manipulation |
| **Jailbreak Attempts** | "DAN mode", "bypass restrictions" |
| **Data Exfiltration** | Attempts to leak sensitive data |
| **Command Injection** | Shell metacharacters, dangerous commands |
| **Path Traversal** | `../` patterns, etc access |
| **SSRF Attempts** | localhost, internal IPs, metadata endpoints |
| **SQL Injection** | Union select, drop table patterns |
| **Credential Leaks** | API keys, tokens in responses |

**Anomaly Detection**:

| Anomaly Type | Threshold |
|--------------|-----------|
| **High Call Rate** | > 60 calls/minute = HIGH, > 30 = MEDIUM |
| **Large Request** | > 1MB |
| **Unusual Tool** | Tool not previously used by user |
| **Off-Hours Access** | Access outside typical hours |
| **High Error Rate** | > 30% = CRITICAL, > 10% = WARNING |
| **Rapid Tool Switching** | Fast switching between different tools |

### 4.4 Risk Scoring

**Formula**:
```
Risk Score = Base Score + Tool Risks + Schema Risks + Endpoint Risks
           = 0-100 (lower is better)
```

**Risk Levels**:
| Score | Level | Auto-Approve |
|-------|-------|--------------|
| 0-30 | LOW | ✅ Yes |
| 31-50 | MEDIUM | ❌ No |
| 51-70 | HIGH | ❌ No |
| 71-100 | CRITICAL | ❌ No |

---

## 5. Policy Engine

### 5.1 Policy Types

| Type | Purpose | Example |
|------|---------|---------|
| **TOOL_DENYLIST** | Block specific tools by pattern | Block all `exec*` tools |
| **TOOL_ALLOWLIST** | Only allow specific tools | Only `read_file`, `search` |
| **CAPABILITY_GATE** | Require approval for capabilities | Write operations need approval |
| **ARGUMENT_FILTER** | Filter/validate tool arguments | Block paths with `../` |
| **RATE_LIMIT** | Limit call frequency | 100 calls/hour per user |
| **ANOMALY_DETECTION** | Flag unusual behavior | Alert on off-hours access |

### 5.2 Policy Evaluation Order

```
1. Global Deny Lists (highest priority)
2. Capability Gates
3. Team-specific Policies
4. Global Allow Lists
```

**Rule**: Deny ALWAYS takes precedence over Allow.

### 5.3 Policy Configuration Examples

**Denylist Policy**:
```json
{
  "name": "Block Dangerous Tools",
  "type": "TOOL_DENYLIST",
  "priority": 100,
  "rules": {
    "patterns": ["execute*", "shell*", "eval*", "sql_exec*"],
    "reason": "Direct execution tools are not allowed"
  }
}
```

**Allowlist Policy**:
```json
{
  "name": "Read-Only Access",
  "type": "TOOL_ALLOWLIST",
  "priority": 50,
  "rules": {
    "servers": {
      "file-server": {
        "tools": ["read_file", "list_directory", "search"]
      }
    }
  }
}
```

**Capability Gate**:
```json
{
  "name": "Write Operations Gate",
  "type": "CAPABILITY_GATE",
  "priority": 80,
  "rules": {
    "capabilities": ["write", "delete", "execute"],
    "action": "REQUIRE_APPROVAL",
    "message": "Write operations require admin approval"
  }
}
```

---

## 6. Runtime Traffic Enforcement

### 6.1 Gateway Security Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GATEWAY SECURITY FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Incoming Request                                                           │
│         │                                                                    │
│         ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ JWT Auth    │ ──── FAIL ──→ 401 Unauthorized                            │
│   └──────┬──────┘                                                           │
│          │ PASS                                                              │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Resolve     │ ──── NOT FOUND ──→ 404 Server Not Found                   │
│   │ Server      │                                                           │
│   └──────┬──────┘                                                           │
│          │ FOUND                                                             │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Anomaly     │ ──── BLOCK ──→ 429 Rate Limited / 403 Blocked             │
│   │ Detection   │                + Audit Log (BLOCKED)                       │
│   └──────┬──────┘                                                           │
│          │ ALLOW                                                             │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Threat      │ ──── BLOCK ──→ 403 Threat Detected                        │
│   │ Detection   │                + Audit Log (BLOCKED)                       │
│   └──────┬──────┘                                                           │
│          │ ALLOW                                                             │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Dangerous   │ ──── MATCH ──→ 403 Tool Not Allowed                       │
│   │ Tool Check  │                + Audit Log (BLOCKED)                       │
│   └──────┬──────┘                                                           │
│          │ NO MATCH                                                          │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Policy      │ ──── DENY ──→ 403 Policy Blocked                          │
│   │ Evaluation  │               + Audit Log (BLOCKED)                        │
│   └──────┬──────┘                                                           │
│          │ ALLOW                                                             │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Schema      │ ──── INVALID ──→ 400 Validation Failed                    │
│   │ Validation  │                                                           │
│   └──────┬──────┘                                                           │
│          │ VALID                                                             │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Proxy to    │ ──→ Backend MCP Server                                    │
│   │ Backend     │                                                           │
│   └──────┬──────┘                                                           │
│          │                                                                    │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Response    │ ──── LEAK ──→ Alert + Sanitize (or Block)                 │
│   │ Scan        │                                                           │
│   └──────┬──────┘                                                           │
│          │                                                                    │
│          ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │ Audit Log   │ ──→ PostgreSQL                                            │
│   └──────┬──────┘                                                           │
│          │                                                                    │
│          ▼                                                                    │
│   Return Response to Client                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 What Gets Blocked?

| Check | Blocked When | Error Response |
|-------|--------------|----------------|
| **Anomaly Detection** | `recommendedAction === 'BLOCK'` | 403 + PolicyBlockedError |
| **Threat Detection** | `threatResult.shouldBlock === true` | 403 + PolicyBlockedError |
| **Dangerous Tools** | Tool matches DANGEROUS_TOOL_PATTERNS | 403 + ToolNotAllowedError |
| **Policy Engine** | `policyResult.allowed === false` | 403 + PolicyBlockedError |
| **Schema Validation** | Arguments don't match schema | 400 + ValidationError |

### 6.3 Dangerous Tool Patterns (Gateway)

```javascript
const DANGEROUS_TOOL_PATTERNS = [
  /^(execute|exec|run|shell|bash|sh|cmd|command|powershell)/i,
  /^(system|spawn|popen|proc|process)/i,
  /\b(eval|exec)\b/i,
  /^(sudo|su|root)/i,
  /^(rm|del|remove|delete|unlink|rmdir)(\s|_|-|$)/i,
  /^(chmod|chown|chgrp)/i,
  /^(kill|pkill|killall)/i,
  /^(curl|wget|fetch|http_request).*url.*\{/i,
];
```

---

## 7. Authentication & Authorization

### 7.1 Authentication Methods

**LDAP/Active Directory (Recommended for Enterprise)**:
- Direct bind authentication with corporate credentials
- Supports multiple username formats:
  - `username` (plain)
  - `DOMAIN\username` (legacy)
  - `username@domain.com` (UPN)
- Group membership extraction via `memberOf` attribute
- Just-in-Time (JIT) user provisioning

**Environment Variables**:
```bash
AUTH_MODE=ldap
LDAP_URL=ldap://your-dc.example.com:389
LDAP_SECURE_URL=ldaps://your-dc.example.com:636
AD_DOMAIN=EXAMPLE
LDAP_BASE_DN=DC=example,DC=com
AD_ADMIN_GROUPS=mcp-manager-admins
AD_USER_GROUPS=mcp-manager-users
JWT_SECRET=your-secret-key
```

### 7.2 Authorization (RBAC)

**Organization Roles**:
| Role | Permissions |
|------|-------------|
| **OWNER** | Full access, can delete org |
| **ADMIN** | Manage servers, policies, teams, users |
| **MEMBER** | Use approved servers, view audit logs |
| **VIEWER** | Read-only access |

**Team Roles**:
| Role | Permissions |
|------|-------------|
| **LEAD** | Manage team settings and members |
| **MEMBER** | Full team access |
| **VIEWER** | Read-only team access |

### 7.3 Permission System

Permissions derived from AD groups:
```javascript
const GROUP_PERMISSIONS = {
  admin: [
    '*',  // All permissions
  ],
  user: [
    'servers:read',
    'servers:write',
    'policies:read',
    'audit:read',
    'teams:read',
  ],
  viewer: [
    'servers:read',
    'policies:read',
    'audit:read',
    'teams:read',
  ],
};
```

---

## 8. Audit Logging

### 8.1 What's Logged

Every action in MCP Manager is logged to the audit trail:

| Event Type | Category | Description |
|------------|----------|-------------|
| `server.registered` | server | New server registered |
| `server.updated` | server | Server details updated |
| `server.deleted` | server | Server deleted |
| `version.created` | version | New version created |
| `version.scanned` | version | Version scanned |
| `version.approved` | version | Version approved |
| `version.rejected` | version | Version rejected |
| `version.revoked` | version | Version revoked |
| `tools.list` | mcp | Tool list requested |
| `tools.call` | mcp | Tool called |
| `tools.blocked` | mcp | Tool call blocked |
| `policy.created` | policy | Policy created |
| `policy.updated` | policy | Policy updated |
| `policy.deleted` | policy | Policy deleted |
| `auth.success` | auth | Login success |
| `auth.failure` | auth | Login failure |
| `admin.emergency_revoke` | admin | Emergency revocation |

### 8.2 Audit Event Structure

```typescript
interface AuditEvent {
  id: string;
  orgId: string;
  
  // Who
  actorType: 'USER' | 'SERVICE' | 'SYSTEM';
  userId?: string;
  
  // What
  eventType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  
  // MCP-specific
  serverName?: string;
  toolName?: string;
  
  // Context
  correlationId: string;
  status: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  
  // Details
  metadata: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  
  // Request/Response
  requestPayload?: any;
  responsePayload?: any;
  durationMs?: number;
  
  // Timestamps
  createdAt: Date;
}
```

### 8.3 Audit Query API

```http
GET /api/audit?
  startDate=2025-01-01&
  endDate=2025-01-31&
  eventType=tools.call&
  serverName=file-server&
  status=BLOCKED&
  limit=100&
  offset=0
```

---

## 9. GitHub Copilot Integration

### 9.1 How It Works

MCP Manager integrates with GitHub Copilot Enterprise to:
1. **Sync Allowlist**: Push approved servers to GitHub's MCP allowlist
2. **Auto-Remove**: Remove revoked servers automatically
3. **Discovery**: GitHub Copilot uses MCP Manager's registry

### 9.2 Scope Levels

| Level | API Endpoint | Use Case |
|-------|--------------|----------|
| **Enterprise** | `/enterprises/{enterprise}/copilot/mcp-servers` | All users under enterprise |
| **Organization** | `/orgs/{org}/copilot/mcp-servers` | Users in specific org |

### 9.3 Configuration

```bash
# GitHub integration
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_SCOPE_LEVEL=enterprise  # or 'organization'
GITHUB_ENTERPRISE_NAME=my-enterprise
GITHUB_ORG_NAME=my-org
GITHUB_AUTH_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_AUTO_SYNC=true
```

### 9.4 Sync Flow

```
MCP Manager                         GitHub Enterprise
     │                                    │
     │ 1. Server Approved                 │
     ├────────────────────────────────────►
     │    PUT /enterprises/{e}/copilot/   │
     │         mcp-servers                │
     │                                    │
     │ 2. Server Revoked                  │
     ├────────────────────────────────────►
     │    PUT /enterprises/{e}/copilot/   │
     │         mcp-servers                │
     │    (without revoked server)        │
     │                                    │
     │ 3. Copilot Discovers               │
     │◄────────────────────────────────────
     │    GET /v0.1/servers               │
     │    (from MCP Manager Registry)     │
     │                                    │
```

---

## 10. API Reference

### 10.1 Control Plane API (Port 3001)

#### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | LDAP login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user |

#### Servers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/servers` | List servers |
| POST | `/api/servers` | Register server |
| GET | `/api/servers/:id` | Get server |
| PUT | `/api/servers/:id` | Update server |
| DELETE | `/api/servers/:id` | Delete server |
| POST | `/api/servers/:id/versions` | Create version |
| POST | `/api/servers/:id/approve` | Approve version |
| POST | `/api/servers/:id/reject` | Reject version |
| POST | `/api/servers/:id/revoke` | Revoke server |
| POST | `/api/servers/:id/scan` | Trigger scan |

#### Policies
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/policies` | List policies |
| POST | `/api/policies` | Create policy |
| GET | `/api/policies/:id` | Get policy |
| PUT | `/api/policies/:id` | Update policy |
| DELETE | `/api/policies/:id` | Delete policy |
| POST | `/api/policies/:id/toggle` | Enable/disable |

#### Teams
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teams` | List teams |
| POST | `/api/teams` | Create team |
| GET | `/api/teams/:id` | Get team |
| PUT | `/api/teams/:id` | Update team |
| DELETE | `/api/teams/:id` | Delete team |
| POST | `/api/teams/:id/members` | Add member |
| DELETE | `/api/teams/:id/members/:userId` | Remove member |

#### Audit
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audit` | Query events |
| GET | `/api/audit/:id` | Get event |
| GET | `/api/audit/stats` | Get statistics |
| GET | `/api/audit/event-types` | List event types |

### 10.2 Registry API (Port 3002)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v0.1/servers` | List approved servers |
| GET | `/v0.1/servers/{name}/versions/latest` | Get latest version |
| GET | `/v0.1/servers/{name}/versions/{version}` | Get specific version |
| GET | `/v0.1/servers/{name}/versions` | List all versions |
| GET | `/v0.1/health` | Health check |
| GET | `/v0.1/ping` | Ping |
| GET | `/v0.1/version` | Version info |

### 10.3 Gateway API (Port 3003)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/mcp/:org/:server` | MCP JSON-RPC endpoint |
| GET | `/health` | Health check |

**MCP Methods Supported**:
- `initialize` - Initialize connection
- `tools/list` - List available tools
- `tools/call` - Execute a tool
- `resources/list` - List resources
- `resources/read` - Read a resource
- `prompts/list` - List prompts
- `prompts/get` - Get a prompt

---

## 11. Database Schema

### 11.1 Core Entities

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Organization   │────<│      Team       │────<│   TeamMember    │
│                 │     │                 │     │                 │
│ - id            │     │ - id            │     │ - id            │
│ - name          │     │ - name          │     │ - userId        │
│ - slug          │     │ - orgId         │     │ - teamId        │
│ - plan          │     │ - environment   │     │ - role          │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         │1:N
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│      User       │     │     Server      │────<│  ServerVersion  │
│                 │     │                 │     │                 │
│ - id            │     │ - id            │     │ - id            │
│ - email         │     │ - name          │     │ - version       │
│ - externalId    │     │ - endpoint      │     │ - status        │
│ - role          │     │ - status        │     │ - riskScore     │
└─────────────────┘     │ - orgId         │     │ - riskLevel     │
                        └─────────────────┘     └────────┬────────┘
                                                         │
                                                         │1:N
                                                         ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │    Approval     │     │   ToolSchema    │
                        │                 │     │                 │
                        │ - id            │     │ - id            │
                        │ - versionId     │     │ - versionId     │
                        │ - decision      │     │ - name          │
                        │ - userId        │     │ - inputSchema   │
                        │ - isAutomatic   │     │ - capabilities  │
                        └─────────────────┘     │ - isDangerous   │
                                                └─────────────────┘
```

### 11.2 Supporting Entities

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Policy      │     │    AuditEvent   │     │     ScanJob     │
│                 │     │                 │     │                 │
│ - id            │     │ - id            │     │ - id            │
│ - name          │     │ - orgId         │     │ - versionId     │
│ - type          │     │ - eventType     │     │ - status        │
│ - rules (JSON)  │     │ - action        │     │ - results       │
│ - priority      │     │ - status        │     │ - startedAt     │
│ - isEnabled     │     │ - metadata      │     │ - completedAt   │
└─────────────────┘     └─────────────────┘     └─────────────────┘

┌─────────────────┐     ┌─────────────────┐
│ TeamServerAccess│     │     ApiKey      │
│                 │     │                 │
│ - teamId        │     │ - id            │
│ - serverId      │     │ - orgId         │
│ - accessLevel   │     │ - name          │
│ - allowedTools  │     │ - hashedKey     │
│ - deniedTools   │     │ - permissions   │
└─────────────────┘     └─────────────────┘
```

---

## 12. Deployment Architecture

### 12.1 Local Development

```bash
# Start PostgreSQL and Redis
docker compose up -d

# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Push schema
pnpm db:push

# Seed sample data
pnpm db:seed

# Start all services
pnpm dev
```

### 12.2 Production (Kubernetes)

```yaml
# Recommended replicas
┌────────────────┬──────────┬────────────────────────┐
│ Service        │ Replicas │ Resources              │
├────────────────┼──────────┼────────────────────────┤
│ Admin UI       │ 2        │ 256Mi RAM, 100m CPU    │
│ Control Plane  │ 3        │ 512Mi RAM, 250m CPU    │
│ Gateway        │ 3+       │ 1Gi RAM, 500m CPU      │
│ Registry       │ 2        │ 256Mi RAM, 100m CPU    │
│ Scanner        │ 2        │ 512Mi RAM, 250m CPU    │
│ PostgreSQL     │ 3 (HA)   │ 2Gi RAM, 1 CPU         │
│ Redis          │ 3 (HA)   │ 512Mi RAM, 250m CPU    │
└────────────────┴──────────┴────────────────────────┘
```

### 12.3 Network Architecture

```
                          Internet
                              │
                              ▼
                     ┌────────────────┐
                     │ Load Balancer  │
                     │   (Ingress)    │
                     └───────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐         ┌─────────┐          ┌─────────┐
   │Admin UI │         │Registry │          │ Gateway │
   │ :3000   │         │ :3002   │          │ :3003   │
   └────┬────┘         └─────────┘          └────┬────┘
        │                                        │
        ▼                                        │
   ┌─────────────┐                              │
   │Control Plane│◄─────────────────────────────┘
   │   :3001     │
   └──────┬──────┘
          │
          ▼
   ┌──────────────────────────────────────┐
   │           Internal Network           │
   │  ┌──────────┐  ┌──────┐  ┌────────┐ │
   │  │PostgreSQL│  │Redis │  │Scanner │ │
   │  └──────────┘  └──────┘  └────────┘ │
   └──────────────────────────────────────┘
```

---

## 13. Configuration

### 13.1 Environment Variables

```bash
# =====================
# DATABASE
# =====================
DATABASE_URL=postgresql://user:password@localhost:5432/mcp_manager

# =====================
# REDIS
# =====================
REDIS_URL=redis://localhost:6379

# =====================
# SERVICE PORTS
# =====================
ADMIN_UI_PORT=3000
CONTROL_PLANE_PORT=3001
REGISTRY_PORT=3002
GATEWAY_PORT=3003
SCANNER_PORT=3004

# =====================
# GATEWAY
# =====================
GATEWAY_URL=http://localhost:3003

# =====================
# AUTHENTICATION
# =====================
AUTH_MODE=ldap
LDAP_URL=ldap://your-dc.example.com:389
LDAP_SECURE_URL=ldaps://your-dc.example.com:636
AD_DOMAIN=EXAMPLE
LDAP_BASE_DN=DC=example,DC=com
AD_ADMIN_GROUPS=mcp-manager-admins
AD_USER_GROUPS=mcp-manager-users
JWT_SECRET=your-256-bit-secret
JWT_EXPIRES_IN=24h

# =====================
# SCANNER
# =====================
SCANNER_INTERVAL_MS=30000
AUTO_APPROVE_THRESHOLD=30

# =====================
# SOURCE CODE SCANNING
# =====================
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITLAB_TOKEN=glpat-xxxxxxxxxxxx
BITBUCKET_APP_PASSWORD=xxxxxxxxxx
AZURE_DEVOPS_PAT=xxxxxxxxxx

# =====================
# GITHUB COPILOT SYNC
# =====================
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_SCOPE_LEVEL=enterprise
GITHUB_ENTERPRISE_NAME=my-enterprise
GITHUB_AUTH_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_AUTO_SYNC=true

# =====================
# LOGGING
# =====================
LOG_LEVEL=info
LOG_FORMAT=json  # or 'pretty' for development
```

### 13.2 AD Group Configuration

Create these AD groups in your domain:
- `mcp-manager-admins` - Full administrative access
- `mcp-manager-users` - Standard user access
- `mcp-manager-viewers` - Read-only access

---

## Summary

MCP Manager provides comprehensive enterprise governance for MCP servers through:

1. **Registration & Approval Workflow** - No server is trusted by default
2. **Multi-Level Security Scanning** - Static analysis, source code scanning, runtime threat detection
3. **Policy Engine** - Fine-grained access control with deny/allow lists
4. **Runtime Enforcement** - All traffic through Gateway with real-time blocking
5. **Complete Audit Trail** - Every action logged for compliance
6. **GitHub Copilot Integration** - Native sync with enterprise allowlists
7. **Enterprise Authentication** - Active Directory/LDAP SSO

The system follows a **Zero Trust** architecture where:
- All MCP servers must be registered and scanned
- All traffic flows through the Gateway
- All operations are logged
- Threats are blocked in real-time
- Policies are enforced at runtime

---

*Document Version: 1.0*  
*Last Updated: January 2026*  
*MCP Manager Version: 0.1.0*
