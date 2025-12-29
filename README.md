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

### System Architecture

```mermaid
flowchart TB
    subgraph External["External Clients"]
        Copilot["🤖 GitHub Copilot"]
        IDE["💻 IDE/Editor"]
        CLI["⌨️ CLI Tools"]
    end

    subgraph MCPManager["MCP Manager Platform"]
        subgraph ControlPlane["Control Plane"]
            AdminUI["🖥️ Admin UI<br/>(Next.js :3000)"]
            ControlAPI["⚙️ Control Plane API<br/>(Fastify :3001)"]
            Scanner["🔍 Scanner Worker<br/>(:3004)"]
        end

        subgraph DataPlane["Data Plane"]
            Registry["📋 Registry<br/>(Fastify :3002)<br/>MCP Registry v0.1"]
            Gateway["🚪 Gateway<br/>(Fastify :3003)<br/>Runtime Proxy"]
        end

        subgraph DataStores["Data Stores"]
            PostgreSQL[("🐘 PostgreSQL<br/>Prisma ORM")]
            Redis[("⚡ Redis<br/>Cache/Sessions")]
        end

        subgraph Security["Security Layer"]
            ThreatDetector["🛡️ Threat Detector"]
            AnomalyDetector["📊 Anomaly Detector"]
            PolicyEngine["📜 Policy Engine"]
            SourceScanner["🔬 Source Code Scanner"]
        end
    end

    subgraph Backend["Backend MCP Servers"]
        MCP1["🔧 MCP Server 1<br/>(Internal)"]
        MCP2["🔧 MCP Server 2<br/>(Internal)"]
        MCP3["🔧 MCP Server 3<br/>(External)"]
    end

    %% External to MCP Manager
    Copilot -->|"1. GET /v0.1/servers<br/>Discover servers"| Registry
    IDE -->|"1. Discover"| Registry
    CLI -->|"1. Discover"| Registry

    Registry -->|"2. Returns Gateway URLs<br/>(not real endpoints)"| Copilot

    Copilot -->|"3. POST /mcp/:org/:server<br/>All MCP traffic"| Gateway
    IDE -->|"3. MCP Traffic"| Gateway
    CLI -->|"3. MCP Traffic"| Gateway

    %% Control Plane
    AdminUI -->|"REST API"| ControlAPI
    ControlAPI --> PostgreSQL
    Scanner --> PostgreSQL
    Scanner -->|"Scans on registration"| MCP1
    Scanner -->|"Scans on registration"| MCP2

    %% Data Plane
    Registry --> PostgreSQL
    Gateway --> PostgreSQL
    Gateway --> ThreatDetector
    Gateway --> AnomalyDetector
    Gateway --> PolicyEngine

    %% Gateway to Backend
    Gateway -->|"4. Proxies to<br/>real endpoint"| MCP1
    Gateway -->|"4. Proxies to<br/>real endpoint"| MCP2
    Gateway -->|"4. Proxies to<br/>real endpoint"| MCP3

    %% Security
    SourceScanner -->|"Scans repos"| GitHub["📦 GitHub/GitLab"]

    classDef external fill:#e1f5fe,stroke:#01579b
    classDef control fill:#fff3e0,stroke:#e65100
    classDef data fill:#e8f5e9,stroke:#2e7d32
    classDef store fill:#fce4ec,stroke:#880e4f
    classDef security fill:#f3e5f5,stroke:#7b1fa2
    classDef backend fill:#eceff1,stroke:#37474f

    class Copilot,IDE,CLI external
    class AdminUI,ControlAPI,Scanner control
    class Registry,Gateway data
    class PostgreSQL,Redis store
    class ThreatDetector,AnomalyDetector,PolicyEngine,SourceScanner security
    class MCP1,MCP2,MCP3 backend
```

### Traffic Flow: How Interception Works

```mermaid
sequenceDiagram
    autonumber
    participant User as 👤 Developer
    participant Admin as 👨‍💼 Admin
    participant UI as 🖥️ Admin UI
    participant CP as ⚙️ Control Plane
    participant Scanner as 🔍 Scanner
    participant DB as 🐘 PostgreSQL
    participant Registry as 📋 Registry
    participant Copilot as 🤖 GitHub Copilot
    participant Gateway as 🚪 Gateway
    participant MCP as 🔧 MCP Server

    rect rgb(255, 243, 224)
        Note over User,MCP: Phase 1: Server Registration & Approval
        User->>UI: Register MCP Server<br/>endpoint: https://my-server:8080
        UI->>CP: POST /api/servers
        CP->>DB: Create Server (status: PENDING)
        CP->>DB: Create ScanJob
        Scanner->>DB: Poll for pending jobs
        Scanner->>MCP: Connect & introspect<br/>tools/list
        Scanner->>Scanner: Analyze tool schemas<br/>Compute risk score
        Scanner->>DB: Update risk score & tools
        
        alt Risk Score ≤ 30
            Scanner->>DB: Auto-approve ✅
        else Risk Score > 30
            Admin->>UI: Review & Approve
            UI->>CP: POST /api/servers/:id/approve
            CP->>DB: Set status: APPROVED
        end
    end

    rect rgb(232, 245, 233)
        Note over User,MCP: Phase 2: Discovery (Registry)
        Copilot->>Registry: GET /v0.1/servers
        Registry->>DB: Query approved servers
        Registry->>Copilot: Returns Gateway URL<br/>NOT real endpoint!
        Note over Copilot: Copilot sees:<br/>url: gateway.com/mcp/acme/my-server<br/>(never sees https://my-server:8080)
    end

    rect rgb(227, 242, 253)
        Note over User,MCP: Phase 3: Runtime Traffic (Gateway)
        Copilot->>Gateway: POST /mcp/acme/my-server<br/>{"method": "tools/call", "params": {...}}
        Gateway->>Gateway: 1️⃣ Authenticate user
        Gateway->>DB: 2️⃣ Resolve real endpoint
        Gateway->>Gateway: 3️⃣ Anomaly detection
        Gateway->>Gateway: 4️⃣ Threat detection
        Gateway->>Gateway: 5️⃣ Policy evaluation
        
        alt Security Check Failed
            Gateway->>DB: Log: BLOCKED
            Gateway->>Copilot: ❌ Error: Blocked
        else Security Check Passed
            Gateway->>MCP: 6️⃣ Proxy to real server
            MCP->>Gateway: Response
            Gateway->>Gateway: 7️⃣ Scan response<br/>(credential leaks, PII)
            Gateway->>DB: 8️⃣ Audit log
            Gateway->>Copilot: ✅ Response
        end
    end
```

### Database Schema (Entity Relationship)

```mermaid
erDiagram
    Organization ||--o{ Team : has
    Organization ||--o{ User : has
    Organization ||--o{ Server : owns
    Organization ||--o{ Policy : defines
    Organization ||--o{ AuditEvent : logs
    Organization ||--o{ ApiKey : has

    Team ||--o{ TeamMember : has
    Team ||--o{ Policy : "scoped to"
    Team ||--o{ TeamServerAccess : grants

    User ||--o{ TeamMember : "belongs to"
    User ||--o{ Approval : makes
    User ||--o{ AuditEvent : triggers

    Server ||--o{ ServerVersion : has
    Server ||--o{ TeamServerAccess : "accessed by"

    ServerVersion ||--o{ ToolSchema : contains
    ServerVersion ||--o{ Approval : requires
    ServerVersion ||--o{ ScanJob : triggers

    Organization {
        string id PK
        string name UK
        string slug UK
        enum plan "FREE|TEAM|ENTERPRISE"
        json settings
    }

    Team {
        string id PK
        string orgId FK
        string name
        string environment
    }

    User {
        string id PK
        string orgId FK
        string email UK
        enum role "OWNER|ADMIN|MEMBER|VIEWER"
        enum status "ACTIVE|SUSPENDED|PENDING"
    }

    Server {
        string id PK
        string orgId FK
        string name UK
        string endpoint "Real MCP server URL"
        enum transport "HTTP_SSE|STDIO"
        enum status "PENDING|ACTIVE|SUSPENDED"
        string repositoryUrl "For source scanning"
        boolean isPublic
    }

    ServerVersion {
        string id PK
        string serverId FK
        string version
        enum status "PENDING_SCAN|SCANNING|APPROVED|REJECTED"
        int riskScore "0-100"
        enum riskLevel "LOW|MEDIUM|HIGH|CRITICAL"
        json evidenceBundle
    }

    ToolSchema {
        string id PK
        string versionId FK
        string name
        json inputSchema
        array capabilities "read|write|exec|network"
        boolean isDangerous
    }

    Policy {
        string id PK
        string orgId FK
        string teamId FK "optional"
        enum type "ALLOWLIST|DENYLIST|RATE_LIMIT|CAPABILITY_GATE"
        json rules
        int priority
        boolean isEnabled
    }

    ScanJob {
        string id PK
        string versionId FK
        enum scanType "API|SOURCE_CODE|DEPENDENCY|FULL"
        enum status "PENDING|RUNNING|COMPLETED|FAILED"
        json vulnerabilities
    }

    AuditEvent {
        string id PK
        string orgId FK
        string userId FK
        string eventType "tools.call|server.approve"
        string toolName
        string serverName
        enum status "SUCCESS|FAILURE|BLOCKED"
        json metadata
    }
```

### Security Scanning Pipeline

```mermaid
flowchart TB
    subgraph Registration["📝 Registration-Time Scanning"]
        Register["User Registers<br/>MCP Server"]
        CreateJob["Create Scan Job"]
        
        subgraph StaticScan["Static Analysis"]
            Connect["Connect to Server"]
            Introspect["tools/list Introspection"]
            AnalyzeTools["Analyze Tool Names<br/>execute, shell, eval"]
            AnalyzeSchemas["Analyze Schemas<br/>Missing validation"]
            CheckEndpoint["Check Endpoint<br/>HTTPS? Internal IP?"]
        end
        
        subgraph VulnScan["Vulnerability Scan"]
            ToolVulns["Tool Pattern Matching"]
            SSRFCheck["SSRF Detection"]
            SchemaVulns["Schema Vulnerabilities"]
        end
        
        RiskScore["Compute Risk Score<br/>0-100"]
        
        Decision{{"Risk ≤ 30?"}}
        AutoApprove["✅ Auto-Approve"]
        ManualReview["⏳ Pending Review"]
    end

    subgraph SourceCode["🔬 Source Code Scanning (Optional)"]
        FetchRepo["Fetch Repository"]
        CodeAnalysis["Static Code Analysis"]
        SecretScan["Secret Detection<br/>API Keys, Passwords"]
        DepScan["Dependency Scan<br/>CVEs, Outdated"]
    end

    subgraph Runtime["🚦 Runtime Scanning"]
        Request["Incoming MCP Request"]
        
        subgraph Checks["Security Checks"]
            Auth["🔐 Authentication"]
            Anomaly["📊 Anomaly Detection<br/>Rate, Behavior"]
            Threat["🛡️ Threat Detection"]
            PolicyCheck["📜 Policy Evaluation"]
        end
        
        subgraph ThreatTypes["Threat Types Detected"]
            PromptInj["Prompt Injection<br/>ignore instructions"]
            CmdInj["Command Injection<br/>; rm -rf /"]
            PathTrav["Path Traversal<br/>../../../etc"]
            SSRF["SSRF<br/>localhost, 169.254"]
            SQLInj["SQL Injection<br/>' OR 1=1"]
            DataExfil["Data Exfiltration"]
        end

        subgraph PolicyTypes["Policy Types"]
            Allowlist["Tool Allowlist"]
            Denylist["Tool Denylist"]
            CapGate["Capability Gates"]
            RateLimit["Rate Limits"]
            ArgFilter["Argument Filters"]
        end
        
        Proxy["Proxy to Backend"]
        ResponseScan["Scan Response<br/>Credential Leaks, PII"]
        AuditLog["📝 Audit Log"]
    end

    Register --> CreateJob --> Connect
    Connect --> Introspect --> AnalyzeTools
    AnalyzeTools --> AnalyzeSchemas --> CheckEndpoint
    CheckEndpoint --> ToolVulns --> SSRFCheck --> SchemaVulns
    SchemaVulns --> RiskScore --> Decision
    Decision -->|Yes| AutoApprove
    Decision -->|No| ManualReview

    FetchRepo --> CodeAnalysis --> SecretScan --> DepScan

    Request --> Auth --> Anomaly --> Threat --> PolicyCheck
    Threat --> ThreatTypes
    PolicyCheck --> PolicyTypes
    PolicyCheck -->|Allowed| Proxy --> ResponseScan --> AuditLog
    PolicyCheck -->|Blocked| AuditLog

    classDef register fill:#fff3e0,stroke:#e65100
    classDef source fill:#e8f5e9,stroke:#2e7d32
    classDef runtime fill:#e3f2fd,stroke:#1565c0
    classDef threat fill:#ffebee,stroke:#c62828
    classDef policy fill:#f3e5f5,stroke:#7b1fa2

    class Register,CreateJob,Connect,Introspect,AnalyzeTools,AnalyzeSchemas,CheckEndpoint,RiskScore,Decision,AutoApprove,ManualReview register
    class FetchRepo,CodeAnalysis,SecretScan,DepScan source
    class Request,Auth,Anomaly,Threat,PolicyCheck,Proxy,ResponseScan,AuditLog runtime
    class PromptInj,CmdInj,PathTrav,SSRF,SQLInj,DataExfil threat
    class Allowlist,Denylist,CapGate,RateLimit,ArgFilter policy
```

### Kubernetes Deployment Architecture

```mermaid
flowchart TB
    subgraph Internet["🌐 Internet"]
        Users["Users/Clients"]
    end

    subgraph K8s["☸️ Kubernetes Cluster (MKE)"]
        Ingress["🔀 Ingress Controller<br/>TLS Termination"]

        subgraph NS["namespace: mcp-manager"]
            subgraph Frontend["Frontend"]
                AdminPod["Admin UI<br/>replicas: 2"]
            end

            subgraph API["API Layer"]
                CPPod["Control Plane<br/>replicas: 2"]
                GWPod["Gateway<br/>replicas: 3"]
                RegPod["Registry<br/>replicas: 2"]
            end

            subgraph Workers["Background Workers"]
                ScanPod["Scanner<br/>replicas: 2"]
            end

            subgraph Storage["Persistent Storage"]
                PG[("PostgreSQL<br/>StatefulSet")]
                RD[("Redis<br/>StatefulSet")]
            end

            subgraph Config["Configuration"]
                CM["ConfigMap<br/>mcp-manager-config"]
                Secrets["Secrets<br/>mcp-manager-secrets"]
            end

            subgraph Network["Network Policies"]
                NP1["Allow: Ingress → Frontend"]
                NP2["Allow: Ingress → API"]
                NP3["Allow: API → Storage"]
                NP4["Deny: Frontend → Storage"]
            end
        end
    end

    Users --> Ingress
    Ingress --> AdminPod
    Ingress --> CPPod
    Ingress --> GWPod
    Ingress --> RegPod

    AdminPod --> CPPod
    CPPod --> PG
    GWPod --> PG
    RegPod --> PG
    ScanPod --> PG
    GWPod --> RD

    CPPod --> CM
    CPPod --> Secrets
    GWPod --> Secrets

    classDef ingress fill:#bbdefb,stroke:#1976d2
    classDef frontend fill:#c8e6c9,stroke:#388e3c
    classDef api fill:#fff9c4,stroke:#f9a825
    classDef worker fill:#ffccbc,stroke:#e64a19
    classDef storage fill:#f8bbd9,stroke:#c2185b
    classDef config fill:#d1c4e9,stroke:#7b1fa2

    class Ingress ingress
    class AdminPod frontend
    class CPPod,GWPod,RegPod api
    class ScanPod worker
    class PG,RD storage
    class CM,Secrets config
```

### CI/CD Pipeline

```mermaid
flowchart LR
    subgraph Trigger["🎯 Trigger"]
        Push["Git Push"]
        PR["Pull Request"]
    end

    subgraph Build["🔨 Build Stage"]
        Install["pnpm install"]
        Lint["ESLint + TypeCheck"]
        Test["Run Tests"]
        Prisma["Generate Prisma"]
    end

    subgraph Docker["🐳 Docker Stage"]
        BuildImg["Build Images<br/>admin-ui, control-plane,<br/>gateway, registry, scanner"]
        Push2Reg["Push to Registry"]
    end

    subgraph Deploy["🚀 Deploy Stage"]
        Kustomize["Kustomize Build"]
        Staging["Deploy to Staging"]
        Smoke["Smoke Tests"]
        Production["Deploy to Production"]
    end

    Push --> Install
    PR --> Install
    Install --> Lint --> Test --> Prisma --> BuildImg
    BuildImg --> Push2Reg --> Kustomize
    Kustomize --> Staging --> Smoke
    Smoke -->|Manual Approval| Production

    classDef trigger fill:#e1f5fe,stroke:#0288d1
    classDef build fill:#fff3e0,stroke:#f57c00
    classDef docker fill:#e8f5e9,stroke:#388e3c
    classDef deploy fill:#fce4ec,stroke:#d81b60

    class Push,PR trigger
    class Install,Lint,Test,Prisma build
    class BuildImg,Push2Reg docker
    class Kustomize,Staging,Smoke,Production deploy
```

### GitHub Copilot Integration Flow

```mermaid
sequenceDiagram
    autonumber
    participant Admin as 👨‍💼 GitHub Enterprise Admin
    participant GH as 🐙 GitHub Enterprise
    participant Registry as 📋 MCP Manager Registry
    participant Gateway as 🚪 MCP Manager Gateway
    participant Copilot as 🤖 GitHub Copilot
    participant MCP as 🔧 MCP Server

    rect rgb(255, 243, 224)
        Note over Admin,GH: Configuration (One-time Setup)
        Admin->>GH: Configure MCP Registry URL<br/>https://registry.company.com
        Admin->>GH: Enable MCP for organization
    end

    rect rgb(232, 245, 233)
        Note over Copilot,Registry: Discovery Phase
        Copilot->>Registry: GET /v0.1/servers
        Registry->>Registry: Query approved servers<br/>Filter by org
        Registry->>Copilot: Server list with Gateway URLs
        Note over Copilot: Response:<br/>{"servers": [{"server": {"name": "acme/db-tools", "remotes": [{"url": "https://gateway.company.com/mcp/acme/db-tools"}]}}]}
    end

    rect rgb(227, 242, 253)
        Note over Copilot,MCP: Runtime Phase
        Copilot->>Gateway: tools/list
        Gateway->>Copilot: Available tools
        Copilot->>Gateway: tools/call: query_database
        Gateway->>Gateway: Security checks
        Gateway->>MCP: Proxy request
        MCP->>Gateway: Query results
        Gateway->>Copilot: Filtered response
    end

    rect rgb(243, 229, 245)
        Note over Admin,GH: Optional: Push Sync
        Admin->>Registry: Approve new server
        Registry->>GH: PUT /orgs/{org}/copilot/mcp-servers<br/>Sync allowlist
    end
```

### Monorepo Package Structure

```mermaid
flowchart TB
    subgraph Root["📦 mcp-manager (root)"]
        direction TB
        RootPkg["package.json<br/>pnpm-workspace.yaml<br/>tsconfig.base.json"]
    end

    subgraph Apps["📁 apps/"]
        AdminUI["admin-ui<br/>Next.js 14<br/>React, SWR"]
        ControlPlane["control-plane<br/>Fastify<br/>REST API"]
        Gateway["gateway<br/>Fastify<br/>MCP Proxy"]
        RegistryApp["registry<br/>Fastify<br/>MCP Registry v0.1"]
        ScannerApp["scanner<br/>Node.js Worker"]
    end

    subgraph Packages["📁 packages/"]
        Prisma["prisma<br/>Prisma Client<br/>PostgreSQL"]
        Shared["shared<br/>Types, Utils<br/>Security"]
    end

    subgraph SharedContents["shared/ contents"]
        Schemas["schemas/<br/>Zod Validation"]
        Types["types/<br/>TypeScript Interfaces"]
        Utils["utils/<br/>Logger, Helpers"]
        SecurityMod["security/<br/>Threat Detection<br/>Anomaly Detection<br/>Source Scanner"]
        Integrations["integrations/<br/>GitHub Copilot"]
    end

    Root --> Apps
    Root --> Packages

    AdminUI --> Shared
    ControlPlane --> Shared
    ControlPlane --> Prisma
    Gateway --> Shared
    Gateway --> Prisma
    RegistryApp --> Shared
    RegistryApp --> Prisma
    ScannerApp --> Shared
    ScannerApp --> Prisma

    Shared --> SharedContents

    classDef root fill:#e3f2fd,stroke:#1565c0
    classDef app fill:#fff3e0,stroke:#ef6c00
    classDef pkg fill:#e8f5e9,stroke:#2e7d32
    classDef sub fill:#fce4ec,stroke:#c2185b

    class RootPkg root
    class AdminUI,ControlPlane,Gateway,RegistryApp,ScannerApp app
    class Prisma,Shared pkg
    class Schemas,Types,Utils,SecurityMod,Integrations sub
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

### Level 3: Source Code Scanning (Repository Analysis)

For deeper security analysis, MCP Manager can scan the actual **source code** of MCP servers:

```
Repository URL → Fetch Source → Code Analysis → Secret Detection → Vulnerability Report
```

**Supported Providers:**

| Provider | Token Type | Required Scope |
|----------|-----------|----------------|
| **GitHub** | PAT (Classic/Fine-grained) | `repo` or `contents:read` |
| **GitLab** | Personal Access Token | `read_repository` |
| **Bitbucket** | App Password | `Repositories: Read` |
| **Azure DevOps** | PAT | `Code (Read)` |

**What Gets Detected:**

| Category | Examples | Severity |
|----------|----------|----------|
| **Command Injection** | `child_process.exec(userInput)` | CRITICAL |
| **SQL Injection** | `query("SELECT * " + userInput)` | CRITICAL |
| **Hardcoded Secrets** | `apiKey = "sk-..."` | CRITICAL |
| **Path Traversal** | `readFile(userPath)` | HIGH |
| **Insecure Crypto** | `crypto.createCipher('des', ...)` | HIGH |

📖 See [Source Code Scanning Documentation](docs/SOURCE_CODE_SCANNING.md) for full setup instructions.

## ✨ Features

### Core Features
- ✅ Multi-tenant organization/team structure
- ✅ MCP server registration and approval workflow
- ✅ Automatic vulnerability scanning
- ✅ **Source code scanning** (GitHub, GitLab, Bitbucket, Azure DevOps)
- ✅ Risk scoring with CWE references
- ✅ Policy-based access control
- ✅ Full audit trail
- ✅ Real-time threat detection
- ✅ Rate limiting per user/tool
- ✅ Secret detection in source code

### Integrations
- ✅ GitHub Copilot Enterprise allowlist sync
- ✅ GitHub/GitLab/Bitbucket/Azure DevOps source code access
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
