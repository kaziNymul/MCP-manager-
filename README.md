# MCP Manager

Enterprise-grade SaaS for MCP (Model Context Protocol) governance, security scanning, 
approval workflows, and runtime enforcement.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/typescript-5.3-blue.svg)]()
[![pnpm](https://img.shields.io/badge/pnpm-9.0-orange.svg)]()

## 🎯 What is MCP Manager?

MCP Manager is an enterprise governance layer for [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers. It allows organizations to:

- **Register & Approve** MCP servers before developers can use them
- **Scan for Vulnerabilities** automatically detect dangerous tool patterns
- **Enforce Policies** control which tools each team can access
- **Monitor Usage** full audit trail of all MCP operations
- **Sync with GitHub Copilot** automatically update enterprise allowlists

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Architecture Overview](#-architecture-overview)
- [Two-Level Security Scanning](#-two-level-security-scanning)
- [Features](#-features)
- [Project Structure](#-project-structure)
- [Configuration](#-configuration)
- [GitHub Copilot Integration](#-github-copilot-integration)
- [Enterprise Deployment](#-enterprise-deployment)
- [API Reference](#-api-reference)
- [Contributing](#-contributing)

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+**
- **pnpm 9+** (`npm install -g pnpm`)
- **Docker & Docker Compose**

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/mcp-manager.git
cd mcp-manager

# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up -d

# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Seed sample data
pnpm db:seed

# Start all services in development mode
pnpm dev
```

### Service URLs

| Service | URL | Description |
|---------|-----|-------------|
| **Admin UI** | http://localhost:3000 | Web dashboard |
| **Control Plane API** | http://localhost:3001 | Admin REST API |
| **Registry** | http://localhost:3002 | MCP server discovery |
| **Gateway** | http://localhost:3003 | Runtime MCP proxy |
| **Scanner** | http://localhost:3004 | Background vulnerability scanner |

### Generate Development Token

```bash
node scripts/generate-dev-token.js
```

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP MANAGER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         CONTROL PLANE                                │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │   Admin API  │  │   Scanner    │  │   Admin UI   │               │    │
│  │  │   (Fastify)  │  │   (Worker)   │  │   (Next.js)  │               │    │
│  │  │    :3001     │  │    :3004     │  │    :3000     │               │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────┘               │    │
│  │         │                 │                                          │    │
│  │         └────────┬────────┘                                          │    │
│  │                  ▼                                                   │    │
│  │         ┌──────────────┐                                             │    │
│  │         │  PostgreSQL  │                                             │    │
│  │         │   (Prisma)   │                                             │    │
│  │         └──────────────┘                                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          DATA PLANE                                  │    │
│  │                                                                      │    │
│  │  ┌──────────────────┐              ┌──────────────────┐             │    │
│  │  │    REGISTRY      │              │     GATEWAY       │             │    │
│  │  │      :3002       │              │      :3003        │             │    │
│  │  │                  │              │                   │             │    │
│  │  │  Discovery-time  │              │  Runtime traffic  │             │    │
│  │  │  allowlist for   │              │  inspection &     │             │    │
│  │  │  Copilot/clients │              │  enforcement      │             │    │
│  │  └──────────────────┘              └──────────────────┘             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Registry vs Gateway

| Aspect | Registry | Gateway |
|--------|----------|---------|
| **Purpose** | Discovery-time allowlist | Runtime traffic enforcement |
| **When used** | Before client connects | During MCP operations |
| **What it does** | Lists approved servers | Proxies + inspects MCP calls |
| **Copilot usage** | Checks before connect | All runtime traffic |
| **Enforcement** | "Can this server exist?" | "Can this call proceed?" |

## 🔒 Two-Level Security Scanning

### Level 1: Registration-Time Scanning (Static Analysis)

When a user registers an MCP server, the Scanner Worker automatically:

```
User Registers Server → Scanner → Vulnerability Analysis → Risk Score → Admin Review
```

**What Gets Scanned:**

| Check | What It Detects | Severity |
|-------|-----------------|----------|
| **Tool Patterns** | `execute`, `shell`, `eval`, `sql_query` | CRITICAL |
| **File Operations** | `write_file`, `delete_file`, `rm` | HIGH |
| **Network Access** | `http_request`, `fetch`, `curl` | HIGH |
| **Schema Analysis** | Unvalidated inputs, no maxLength | MEDIUM |
| **Endpoint Security** | HTTP (not HTTPS), internal networks | HIGH |

**Risk Score:**
- **0-25**: LOW ✅ (may auto-approve)
- **26-50**: MEDIUM ⚠️ (review required)
- **51-75**: HIGH 🔶 (detailed review)
- **76-100**: CRITICAL 🔴 (likely reject)

### Level 2: Runtime Scanning (Live Traffic)

Every MCP request through the Gateway is scanned in real-time:

```
Request → Anomaly Check → Threat Detection → Policy Check → Proxy → Response Scan
```

**What Gets Blocked:**

| Threat | Pattern | Example |
|--------|---------|---------|
| **Prompt Injection** | `/ignore previous instructions/i` | "Ignore all rules and..." |
| **Jailbreak** | `/DAN mode/i`, `/bypass safety/i` | "Enable DAN mode" |
| **Command Injection** | Shell metacharacters: `; \| & $` | `; rm -rf /` |
| **Path Traversal** | `../../../etc/passwd` | Directory escape |
| **SSRF** | `localhost`, `169.254.169.254` | Cloud metadata access |
| **SQL Injection** | `' OR 1=1 --` | Database attacks |
| **Credential Leak** | API keys in responses | `sk-...`, `ghp_...` |

## ✨ Features

### Core Features
- ✅ Multi-tenant organization/team structure
- ✅ MCP server registration and approval workflow
- ✅ Automatic vulnerability scanning
- ✅ Risk scoring with CWE references
- ✅ Policy-based access control
- ✅ Full audit trail
- ✅ Real-time threat detection
- ✅ Rate limiting per user/tool

### Integrations
- ✅ GitHub Copilot Enterprise allowlist sync
- ✅ OIDC/JWT authentication
- ✅ Prometheus metrics
- ✅ Kubernetes deployment ready

## 📁 Project Structure

```
mcp_manager/
├── apps/
│   ├── admin-ui/          # Next.js admin dashboard
│   ├── control-plane/     # Fastify admin API
│   ├── gateway/           # MCP runtime proxy
│   ├── registry/          # MCP discovery service
│   └── scanner/           # Background vulnerability scanner
├── packages/
│   ├── prisma/            # Database schema and client
│   └── shared/            # Shared utilities, types, security modules
├── k8s/                   # Kubernetes manifests
│   ├── base/              # Base Kustomize resources
│   └── overlays/          # Environment-specific overlays
├── docs/                  # Documentation
├── scripts/               # Utility scripts
├── docker-compose.yml     # Local development
└── pnpm-workspace.yaml    # Monorepo configuration
```

## ⚙️ Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL=postgresql://mcp:mcp@localhost:5432/mcp_manager

# Authentication
AUTH_MODE=development          # or 'oidc' for production
JWT_SECRET=your-secret-key
JWT_ISSUER=mcp-manager
JWT_AUDIENCE=mcp-manager

# For OIDC (production)
# JWKS_URI=https://your-idp.com/.well-known/jwks.json

# Scanner
SCANNER_INTERVAL_MS=30000
AUTO_APPROVE_THRESHOLD=30      # Risk score auto-approve threshold

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000

# GitHub Integration (optional)
GITHUB_SCOPE_LEVEL=enterprise
GITHUB_ENTERPRISE_NAME=your-enterprise
GITHUB_API_URL=https://github.your-company.com/api/v3
GITHUB_APP_ID=12345
GITHUB_APP_INSTALLATION_ID=67890
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_AUTO_SYNC=true
```

## 🐙 GitHub Copilot Integration

MCP Manager can automatically sync approved servers to GitHub Copilot Enterprise's allowlist.

### Supported Configurations

| Configuration | Description | Use Case |
|---------------|-------------|----------|
| **Enterprise Level** | All users directly under enterprise | No separate orgs |
| **Organization Level** | Users in orgs within enterprise | Multiple orgs |

### Setup for Enterprise (No Organizations)

1. **Create GitHub App** at:
   ```
   https://github.YOUR-COMPANY.com/enterprises/YOUR-ENTERPRISE/settings/apps/new
   ```

2. **Configure Permissions:**
   | Permission | Access |
   |------------|--------|
   | Enterprise → Copilot | Read & Write |
   | Enterprise → Members | Read |
   | Enterprise → Administration | Read |

3. **Get Credentials:**
   - **App ID**: From app settings page
   - **Private Key**: Generate and download `.pem`
   - **Installation ID**: From URL after installing app

4. **Configure Environment:**
   ```bash
   GITHUB_SCOPE_LEVEL=enterprise
   GITHUB_ENTERPRISE_NAME=your-enterprise-slug
   GITHUB_API_URL=https://github.your-company.com/api/v3
   GITHUB_APP_ID=12345
   GITHUB_APP_INSTALLATION_ID=67890
   GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
   ...
   -----END RSA PRIVATE KEY-----"
   GITHUB_AUTO_SYNC=true
   ```

### How Sync Works

```
Admin Approves Server → MCP Manager → GitHub API → Copilot Allowlist Updated
         │
         ▼
     Audit Log
```

Servers are automatically added/removed from GitHub Copilot's allowlist when approved/revoked in MCP Manager.

## 🏢 Enterprise Deployment

For production deployment, see [docs/ENTERPRISE_DEPLOYMENT.md](docs/ENTERPRISE_DEPLOYMENT.md).

### Quick Kubernetes Deployment

```bash
# Build Docker images
docker build -t your-registry/mcp-gateway:v1.0.0 -f apps/gateway/Dockerfile .
docker build -t your-registry/mcp-control-plane:v1.0.0 -f apps/control-plane/Dockerfile .
docker build -t your-registry/mcp-scanner:v1.0.0 -f apps/scanner/Dockerfile .
docker build -t your-registry/mcp-registry:v1.0.0 -f apps/registry/Dockerfile .
docker build -t your-registry/mcp-admin-ui:v1.0.0 -f apps/admin-ui/Dockerfile .

# Push to registry
docker push your-registry/mcp-gateway:v1.0.0
# ... push all images

# Deploy to Kubernetes
kubectl apply -k k8s/overlays/production

# Run migrations
kubectl exec -it deploy/control-plane -n mcp-manager -- npx prisma migrate deploy
```

### Capacity Planning

| Scale | Teams | MCP Servers | RPS | Gateway Pods |
|-------|-------|-------------|-----|--------------|
| Small | 10 | 50 | 100 | 3 |
| Medium | 50 | 200 | 500 | 5 |
| Large | 200 | 1000 | 2000 | 10 |
| Enterprise | 500+ | 5000+ | 10000+ | 20+ |

## 📚 API Reference

### Control Plane API (Port 3001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/servers` | GET | List MCP servers |
| `/api/v1/servers` | POST | Register new server |
| `/api/v1/servers/:id` | GET | Get server details |
| `/api/v1/servers/:id/approve` | POST | Approve server |
| `/api/v1/servers/:id/revoke` | POST | Revoke server |
| `/api/v1/policies` | GET/POST | Manage policies |
| `/api/v1/audit` | GET | Query audit log |
| `/api/v1/sync/github-copilot` | POST | Trigger GitHub sync |

### Registry Service (Port 3002)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/discover` | GET | List approved servers |
| `/api/v1/servers/:name` | GET | Get server details |

### Gateway (Port 3003)

Standard MCP JSON-RPC 2.0 over HTTP:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/:org/:server` | POST | JSON-RPC endpoint |
| `/mcp/:org/:server/sse` | GET | SSE streaming |

## 🔐 Security Model

### Authentication
- **Development**: Static JWT tokens
- **Production**: OIDC with configurable IdP (Okta, Azure AD, etc.)

### Authorization
- Organization-scoped multi-tenancy
- Team-based access control
- Policy-based tool restrictions

### Runtime Controls

| Control | Description |
|---------|-------------|
| Tool Allowlist | Only approved tools callable |
| Destructive Block | `delete`, `drop`, `rm` blocked by default |
| Write Gating | Write operations require explicit policy |
| Rate Limiting | Per-user, per-tool limits |
| Schema Validation | Arguments validated against schemas |
| Audit Logging | Every call logged with correlation ID |

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 📖 Additional Documentation

- [Enterprise Deployment Guide](docs/ENTERPRISE_DEPLOYMENT.md) - Complete production deployment
- [GitHub Enterprise Setup](docs/ENTERPRISE_DEPLOYMENT.md#github-enterprise-integration) - GitHub App configuration
- [Security Architecture](docs/ENTERPRISE_DEPLOYMENT.md#how-scanning-actually-works) - Detailed scanning explanation
