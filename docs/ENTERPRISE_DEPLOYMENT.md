# MCP Manager - Enterprise Deployment Guide

Complete guide for deploying MCP Manager in production with GitHub Enterprise integration,
Kubernetes, and high availability.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [How Security Scanning Works](#how-security-scanning-works)
3. [GitHub Enterprise Integration](#github-enterprise-integration)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [High Availability Architecture](#high-availability-architecture)
6. [Multi-Tenant Configuration](#multi-tenant-configuration)
7. [Security Hardening](#security-hardening)
8. [Monitoring & Observability](#monitoring--observability)
9. [Disaster Recovery](#disaster-recovery)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required
- **Kubernetes 1.25+** (or Docker Compose for smaller deployments)
- **PostgreSQL 14+** (managed RDS/Cloud SQL recommended)
- **Node.js 20+** (for local development)
- **pnpm 9+**

### Optional
- **Redis** (for caching and rate limiting)
- **GitHub Enterprise** (for Copilot allowlist sync)
- **OIDC Provider** (Okta, Azure AD, etc.)
- **Prometheus/Grafana** (for monitoring)

---

## How Security Scanning Works

MCP Manager implements a **two-level security architecture**:

### Level 1: Registration-Time Scanning (Static Analysis)

When a user registers an MCP server, the Scanner Worker performs deep analysis:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       REGISTRATION SCANNING FLOW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. USER REGISTERS SERVER                                                    │
│     POST /api/v1/servers { url: "https://my-mcp-server.com/mcp" }           │
│                              │                                               │
│                              ▼                                               │
│  2. SCANNER CONNECTS TO MCP SERVER                                          │
│     → Sends `initialize` request                                             │
│     → Calls `tools/list` to discover all tools                              │
│                              │                                               │
│                              ▼                                               │
│  3. VULNERABILITY ANALYSIS (for each tool)                                  │
│     ┌─────────────────────────────────────────────────────────┐             │
│     │  Tool: "execute_command"                                 │             │
│     │  ├─ Pattern Match: /^(execute|exec|run|shell)/i ✗ MATCH │             │
│     │  ├─ Severity: CRITICAL                                   │             │
│     │  ├─ CWE: CWE-78 (OS Command Injection)                   │             │
│     │  └─ Risk: +40 points                                     │             │
│     └─────────────────────────────────────────────────────────┘             │
│                              │                                               │
│                              ▼                                               │
│  4. SCHEMA ANALYSIS                                                         │
│     Check each tool's inputSchema for:                                      │
│     ✗ Unvalidated string params (no pattern/maxLength)                      │
│     ✗ Missing required fields                                               │
│     ✗ additionalProperties: true (accepts anything)                         │
│                              │                                               │
│                              ▼                                               │
│  5. RISK SCORE CALCULATION                                                  │
│     ┌────────────────────────────────────────┐                              │
│     │  0-25:  LOW      ✅ Auto-approve?      │                              │
│     │ 26-50:  MEDIUM   ⚠️  Review required   │                              │
│     │ 51-75:  HIGH     🔶 Detailed review    │                              │
│     │ 76-100: CRITICAL 🔴 Likely reject      │                              │
│     └────────────────────────────────────────┘                              │
│                              │                                               │
│                              ▼                                               │
│  6. STORE RESULTS → Notify admin for review                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Dangerous Patterns Detected

| Pattern | Severity | CWE | Description |
|---------|----------|-----|-------------|
| `/^(execute\|exec\|run\|shell\|bash)/i` | CRITICAL | CWE-78 | Command execution |
| `/^(sql\|query\|database)/i` | CRITICAL | CWE-89 | SQL injection risk |
| `/eval\|compile\|interpret/i` | CRITICAL | CWE-94 | Code injection |
| `/^(write\|delete\|remove)_?file/i` | HIGH | CWE-22 | File system modification |
| `/^(http\|fetch\|curl\|wget)/i` | HIGH | CWE-918 | SSRF risk |
| `/^(credential\|password\|secret)/i` | HIGH | CWE-522 | Credential exposure |

### Level 2: Runtime Scanning (Live Traffic)

Every request through the Gateway is scanned in real-time:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RUNTIME SCANNING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MCP CLIENT (GitHub Copilot, Claude, etc.)                                  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                          GATEWAY                                        ││
│  │                                                                         ││
│  │  ┌───────────────────────────────────────────────────────────────────┐  ││
│  │  │  STEP 1: ANOMALY DETECTION                                        │  ││
│  │  │  • Rate limiting (>100 req/min = suspicious)                       │  ││
│  │  │  • Unusual hours for user                                          │  ││
│  │  │  • Request size anomaly                                            │  ││
│  │  │  • New IP address                                                  │  ││
│  │  └───────────────────────────────────────────────────────────────────┘  ││
│  │                              │ PASS                                     ││
│  │                              ▼                                          ││
│  │  ┌───────────────────────────────────────────────────────────────────┐  ││
│  │  │  STEP 2: THREAT DETECTION                                         │  ││
│  │  │                                                                    │  ││
│  │  │  PROMPT INJECTION:   /ignore\s+previous\s+instructions/i          │  ││
│  │  │  COMMAND INJECTION:  /[;&|`$]/ (shell metacharacters)             │  ││
│  │  │  PATH TRAVERSAL:     /\.\.[\/\\]/                                 │  ││
│  │  │  SSRF:               /127\.0\.0\.\d+/, /169\.254\.169\.254/       │  ││
│  │  │  SQL INJECTION:      /union\s+select/i, /'\s*or\s*'?\d*=\d*/i     │  ││
│  │  └───────────────────────────────────────────────────────────────────┘  ││
│  │                              │ PASS                                     ││
│  │                              ▼                                          ││
│  │  ┌───────────────────────────────────────────────────────────────────┐  ││
│  │  │  STEP 3: POLICY ENFORCEMENT                                       │  ││
│  │  │  • Is this tool allowed for this user's team?                      │  ││
│  │  │  • Is this server approved?                                        │  ││
│  │  │  • Validate arguments against schema                               │  ││
│  │  └───────────────────────────────────────────────────────────────────┘  ││
│  │                              │ PASS                                     ││
│  │                              ▼                                          ││
│  │         PROXY TO BACKEND MCP SERVER                                     ││
│  │                              │                                          ││
│  │                              ▼                                          ││
│  │  ┌───────────────────────────────────────────────────────────────────┐  ││
│  │  │  STEP 4: RESPONSE SCANNING                                        │  ││
│  │  │  • API Keys: /sk-[a-zA-Z0-9]{32,}/ (OpenAI)                       │  ││
│  │  │  • Tokens: /ghp_[a-zA-Z0-9]{36}/ (GitHub)                         │  ││
│  │  │  • Private Keys: /-----BEGIN.*PRIVATE KEY-----/                   │  ││
│  │  │  • PII: SSN, Credit Cards                                          │  ││
│  │  └───────────────────────────────────────────────────────────────────┘  ││
│  │                              │                                          ││
│  │                              ▼                                          ││
│  │             LOG TO AUDIT TRAIL → RETURN RESPONSE                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## GitHub Enterprise Integration

MCP Manager can automatically sync approved servers to GitHub Copilot's allowlist.

### Supported Configurations

| Configuration | API Endpoint | Use Case |
|---------------|--------------|----------|
| **Enterprise Level** | `/enterprises/{slug}/copilot/mcp-servers` | All users under enterprise (no orgs) |
| **Organization Level** | `/orgs/{org}/copilot/mcp-servers` | Users organized into orgs |

### Option 1: Enterprise Level (No Organizations)

Use this when all users are directly under your GitHub Enterprise account.

#### Step 1: Create GitHub App

Navigate to:
```
https://github.YOUR-COMPANY.com/enterprises/YOUR-ENTERPRISE-SLUG/settings/apps/new
```

**Finding your Enterprise Slug:**
1. Go to GitHub Enterprise → Your profile → "Your enterprises"
2. Select your enterprise
3. Look at URL: `github.YOUR-COMPANY.com/enterprises/acme-corp` → slug is `acme-corp`

#### Step 2: Configure App Settings

| Setting | Value |
|---------|-------|
| **GitHub App name** | `MCP Manager` |
| **Homepage URL** | `https://mcp.your-company.com` |
| **Webhook Active** | ❌ Unchecked |

#### Step 3: Set Permissions

**Enterprise Permissions:**

| Permission | Access Level | Purpose |
|------------|--------------|---------|
| Copilot Business | Read & Write | Manage MCP server allowlist |
| Members | Read | Verify user membership |
| Administration | Read | Enterprise settings access |

Click **Create GitHub App**

#### Step 4: Get Credentials

**App ID:**
After creation, on the app settings page:
```
App ID: 12345  ← Copy this
```

**Private Key:**
1. Scroll to "Private keys" section
2. Click "Generate a private key"
3. A `.pem` file downloads automatically
4. Keep this file secure!

```bash
# View the private key
cat ~/Downloads/mcp-manager.2024-12-21.private-key.pem

# Output:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2Z3qX2BTLS4e0ek78gB+...
...many lines...
-----END RSA PRIVATE KEY-----
```

**Installation ID:**
1. Click "Install App" in sidebar
2. Select your **Enterprise**
3. Click "Install"
4. Look at the URL after installation:
   ```
   github.YOUR-COMPANY.com/enterprises/acme-corp/settings/installations/67890
                                                                          ↑
                                                         This is your Installation ID
   ```

#### Step 5: Configure MCP Manager

**Environment Variables:**

```bash
# .env file
GITHUB_SCOPE_LEVEL=enterprise
GITHUB_ENTERPRISE_NAME=acme-corp
GITHUB_API_URL=https://github.your-company.com/api/v3
GITHUB_APP_ID=12345
GITHUB_APP_INSTALLATION_ID=67890
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2Z3qX2BTLS...
...entire key content...
-----END RSA PRIVATE KEY-----"
GITHUB_AUTO_SYNC=true
```

**Or Kubernetes Secret:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: github-app-credentials
  namespace: mcp-manager
type: Opaque
stringData:
  GITHUB_SCOPE_LEVEL: "enterprise"
  GITHUB_ENTERPRISE_NAME: "acme-corp"
  GITHUB_API_URL: "https://github.your-company.com/api/v3"
  GITHUB_APP_ID: "12345"
  GITHUB_APP_INSTALLATION_ID: "67890"
  GITHUB_PRIVATE_KEY: |
    -----BEGIN RSA PRIVATE KEY-----
    MIIEpAIBAAKCAQEA2Z3qX2BTLS...
    -----END RSA PRIVATE KEY-----
```

### Option 2: Organization Level

Use this when you have organizations within your enterprise.

#### Step 1: Create GitHub App at Org Level

```
https://github.YOUR-COMPANY.com/organizations/YOUR-ORG/settings/apps/new
```

#### Step 2: Permissions

**Organization Permissions:**

| Permission | Access Level |
|------------|--------------|
| Copilot Business | Read & Write |
| Members | Read |
| Administration | Read |

#### Step 3: Configure

```bash
GITHUB_SCOPE_LEVEL=organization
GITHUB_ORG=your-org-name
GITHUB_API_URL=https://github.your-company.com/api/v3
GITHUB_APP_ID=12345
GITHUB_APP_INSTALLATION_ID=67890
GITHUB_PRIVATE_KEY="..."
GITHUB_AUTO_SYNC=true
```

### Sync Workflow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Admin Approves  │────▶│ Control Plane   │────▶│ GitHub API      │
│  MCP Server     │     │ Triggers Sync   │     │ Update Allowlist│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Audit Log     │
                        │ Records Sync    │
                        └─────────────────┘
```

### Verify Integration

```bash
# Start MCP Manager
pnpm dev

# Open Admin UI
open http://localhost:3000/integrations

# Click "Test Connection"
# Should show:
# ✅ Connected to enterprise: acme-corp
# ✅ Copilot enabled
# ✅ MCP servers feature enabled
```

### Alternative: Using Personal Access Token (PAT)

For simpler setup (less secure, not recommended for production):

1. Go to: `github.YOUR-COMPANY.com/settings/tokens/new`
2. Create token with scopes:
   - `admin:enterprise` (for enterprise level)
   - `admin:org` (for org level)
3. Configure:
   ```bash
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   GITHUB_SCOPE_LEVEL=enterprise
   GITHUB_ENTERPRISE_NAME=acme-corp
   GITHUB_API_URL=https://github.your-company.com/api/v3
   ```

---

## Kubernetes Deployment

### Architecture

```
                                    ┌─────────────────────────────────────────────┐
                                    │              KUBERNETES CLUSTER              │
                                    │                                              │
    ┌──────────────┐               │  ┌─────────────────────────────────────────┐ │
    │   Ingress    │               │  │           INGRESS CONTROLLER            │ │
    │  Controller  │──────────────▶│  │        (nginx / traefik)                │ │
    └──────────────┘               │  └─────────────────────────────────────────┘ │
                                    │         │                    │                │
                                    │         ▼                    ▼                │
                                    │  ┌────────────┐      ┌────────────┐          │
                                    │  │  Admin UI  │      │  Gateway   │          │
                                    │  │ (3 replicas)│      │ (5 replicas)│          │
                                    │  └────────────┘      └────────────┘          │
                                    │         │                    │                │
                                    │         ▼                    ▼                │
                                    │  ┌────────────────────────────────────────┐  │
                                    │  │           CONTROL PLANE API            │  │
                                    │  │              (3 replicas)              │  │
                                    │  └────────────────────────────────────────┘  │
                                    │         │              │              │       │
                                    │         ▼              ▼              ▼       │
                                    │  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
                                    │  │ Registry │  │ Scanner  │  │ Scanner  │   │
                                    │  │(2 replicas)│ │ Worker 1 │  │ Worker 2 │   │
                                    │  └──────────┘  └──────────┘  └──────────┘   │
                                    │         │              │              │       │
                                    │         └──────────────┼──────────────┘       │
                                    │                        ▼                      │
                                    │               ┌──────────────┐                │
                                    │               │  PostgreSQL  │                │
                                    │               │   (Primary)  │                │
                                    │               └──────────────┘                │
                                    │                                              │
                                    └──────────────────────────────────────────────┘
```

### Directory Structure

```
k8s/
├── base/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secrets.yaml
│   ├── rbac.yaml
│   ├── network-policies.yaml
│   ├── ingress.yaml
│   ├── control-plane/
│   │   └── deployment.yaml
│   ├── gateway/
│   │   └── deployment.yaml
│   ├── registry/
│   │   └── deployment.yaml
│   ├── scanner/
│   │   └── deployment.yaml
│   ├── admin-ui/
│   │   └── deployment.yaml
│   └── kustomization.yaml
└── overlays/
    ├── development/
    │   └── kustomization.yaml
    ├── staging/
    │   └── kustomization.yaml
    └── production/
        └── kustomization.yaml
```

### Deployment Steps

#### 1. Build Docker Images

```bash
# From repository root
docker build -t your-registry.com/mcp-manager/gateway:v1.0.0 -f apps/gateway/Dockerfile .
docker build -t your-registry.com/mcp-manager/control-plane:v1.0.0 -f apps/control-plane/Dockerfile .
docker build -t your-registry.com/mcp-manager/scanner:v1.0.0 -f apps/scanner/Dockerfile .
docker build -t your-registry.com/mcp-manager/registry:v1.0.0 -f apps/registry/Dockerfile .
docker build -t your-registry.com/mcp-manager/admin-ui:v1.0.0 -f apps/admin-ui/Dockerfile .
```

#### 2. Push to Registry

```bash
docker push your-registry.com/mcp-manager/gateway:v1.0.0
docker push your-registry.com/mcp-manager/control-plane:v1.0.0
docker push your-registry.com/mcp-manager/scanner:v1.0.0
docker push your-registry.com/mcp-manager/registry:v1.0.0
docker push your-registry.com/mcp-manager/admin-ui:v1.0.0
```

#### 3. Configure Secrets

Edit `k8s/base/secrets.yaml` with your values:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mcp-manager-secrets
  namespace: mcp-manager
type: Opaque
stringData:
  DATABASE_URL: "postgresql://user:pass@postgres:5432/mcp_manager?sslmode=require"
  JWT_SECRET: "your-256-bit-secret"
  OIDC_ISSUER: "https://your-idp.okta.com"
  GITHUB_SCOPE_LEVEL: "enterprise"
  GITHUB_ENTERPRISE_NAME: "your-enterprise"
  GITHUB_API_URL: "https://github.your-company.com/api/v3"
  GITHUB_APP_ID: "12345"
  GITHUB_APP_INSTALLATION_ID: "67890"
  GITHUB_PRIVATE_KEY: |
    -----BEGIN RSA PRIVATE KEY-----
    ...
    -----END RSA PRIVATE KEY-----
```

#### 4. Update Image Tags

Edit `k8s/overlays/production/kustomization.yaml`:

```yaml
images:
  - name: your-registry.com/mcp-manager/gateway
    newTag: v1.0.0
  - name: your-registry.com/mcp-manager/control-plane
    newTag: v1.0.0
  # ... etc
```

#### 5. Deploy

```bash
# Create namespace and deploy
kubectl apply -k k8s/overlays/production

# Verify pods
kubectl get pods -n mcp-manager

# Run database migrations
kubectl exec -it deploy/control-plane -n mcp-manager -- npx prisma migrate deploy

# Seed initial data (optional)
kubectl exec -it deploy/control-plane -n mcp-manager -- npx prisma db seed
```

#### 6. Configure DNS

Point these domains to your ingress:

| Domain | Service |
|--------|---------|
| `mcp.your-company.com` | Admin UI + API |
| `mcp-gateway.your-company.com` | Gateway (MCP clients connect here) |
| `mcp-registry.your-company.com` | Registry (discovery) |

---

## High Availability Architecture

### Multi-Region Deployment

```
┌─────────────────┐         ┌─────────────────┐
│  Region: US-East│         │ Region: EU-West │
│  (Primary)      │◀───────▶│ (Secondary)     │
├─────────────────┤         ├─────────────────┤
│ Gateway (5)     │         │ Gateway (3)     │
│ Control Plane(3)│         │ Control Plane(2)│
│ Scanner (3)     │         │ Scanner (2)     │
│ PostgreSQL (Pri)│────────▶│ PostgreSQL(Rep) │
└─────────────────┘         └─────────────────┘
        │                           │
        └───────────┬───────────────┘
                    ▼
           ┌──────────────┐
           │ Global LB    │
           │ (CloudFlare) │
           └──────────────┘
```

### Capacity Planning

| Scale | Teams | MCP Servers | Requests/sec | Gateway Pods | Database |
|-------|-------|-------------|--------------|--------------|----------|
| Small | 10 | 50 | 100 | 3 | db.t3.medium |
| Medium | 50 | 200 | 500 | 5 | db.r5.large |
| Large | 200 | 1000 | 2000 | 10 | db.r5.xlarge |
| Enterprise | 500+ | 5000+ | 10000+ | 20+ | db.r5.2xlarge |

### Pod Resource Recommendations

```yaml
# Gateway - High traffic, low memory
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "2000m"
    memory: "2Gi"

# Scanner - CPU intensive
resources:
  requests:
    cpu: "1000m"
    memory: "1Gi"
  limits:
    cpu: "4000m"
    memory: "4Gi"

# Control Plane - Moderate
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1000m"
    memory: "1Gi"
```

---

## Multi-Tenant Configuration

### Hierarchy

```
Enterprise (GitHub Enterprise)
├── Organization 1 (Tenant)
│   ├── Team: Platform Engineering
│   │   └── Users: alice, bob
│   ├── Team: Data Science
│   │   └── Users: carol
│   └── MCP Servers (org-scoped)
│       ├── internal/code-search
│       └── internal/db-query
│
└── Organization 2 (Separate Tenant)
    ├── Team: Frontend
    └── Team: Backend
```

### Tenant Isolation

Each request is scoped to the user's organization:

```typescript
// Every API route enforces tenant isolation
fastify.addHook('preHandler', async (request) => {
  const user = request.user;
  const orgId = request.headers['x-organization'];
  
  // Verify user belongs to this org
  const membership = await prisma.userMembership.findFirst({
    where: { userId: user.id, organizationId: orgId },
  });
  
  if (!membership) {
    throw new ForbiddenError('Access denied');
  }
});
```

---

## Security Hardening

### Network Policies

```yaml
# Block all traffic by default
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress

# Gateway can only reach database and external (MCP servers)
# See k8s/base/network-policies.yaml for full policies
```

### Pod Security

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

### Secrets Management

**Recommended: Use External Secrets Operator or Vault**

```yaml
# External Secrets Operator example
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: mcp-manager-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: mcp-manager-secrets
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: secret/mcp-manager/database
        property: url
```

---

## Monitoring & Observability

### Prometheus Metrics

MCP Manager exposes metrics on port 9090:

```
# Request metrics
mcp_gateway_requests_total{method="tools/call", server="weather", status="success"}
mcp_gateway_request_duration_seconds{method="tools/call", quantile="0.99"}

# Security metrics
mcp_gateway_threats_blocked_total{threat_type="prompt_injection", severity="high"}

# Scanner metrics
mcp_scanner_scans_total{status="completed"}
mcp_scanner_vulnerabilities_found{severity="critical"}
```

### Grafana Dashboard

Import the dashboard from `k8s/monitoring/grafana-dashboard.json`:

- Request rate by server
- P99 latency
- Threats blocked (24h)
- Scanner queue depth
- Database connections

### Alerting Rules

```yaml
groups:
  - name: mcp-manager
    rules:
      - alert: HighThreatRate
        expr: sum(rate(mcp_gateway_threats_blocked_total[5m])) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High threat blocking rate detected"
          
      - alert: GatewayHighLatency
        expr: histogram_quantile(0.99, rate(mcp_gateway_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning
```

---

## Disaster Recovery

### Database Backup

```yaml
# CronJob for automated backups
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
spec:
  schedule: "0 */6 * * *"  # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: postgres:16
              command:
                - /bin/sh
                - -c
                - |
                  pg_dump $DATABASE_URL | gzip | \
                  aws s3 cp - s3://mcp-backups/$(date +%Y%m%d-%H%M%S).sql.gz
```

### Recovery Procedure

1. **Restore database:**
   ```bash
   aws s3 cp s3://mcp-backups/BACKUP.sql.gz - | gunzip | psql $DATABASE_URL
   ```

2. **Redeploy services:**
   ```bash
   kubectl apply -k k8s/overlays/production
   ```

3. **Verify connectivity:**
   ```bash
   kubectl exec -it deploy/control-plane -n mcp-manager -- curl http://gateway:3003/health
   ```

---

## Troubleshooting

### Common Issues

#### 1. GitHub Sync Fails

```bash
# Check logs
kubectl logs -l app=control-plane -n mcp-manager | grep github

# Verify credentials
kubectl exec -it deploy/control-plane -n mcp-manager -- \
  node -e "console.log(process.env.GITHUB_APP_ID)"
```

#### 2. Scanner Not Processing

```bash
# Check scanner logs
kubectl logs -l app=scanner -n mcp-manager

# Verify database connectivity
kubectl exec -it deploy/scanner -n mcp-manager -- \
  npx prisma db execute --stdin <<< "SELECT 1"
```

#### 3. Gateway High Latency

```bash
# Check connection pool
kubectl exec -it deploy/gateway -n mcp-manager -- \
  node -e "console.log('DB Pool:', process.env.DATABASE_URL)"

# Check rate limiting
kubectl logs -l app=gateway -n mcp-manager | grep "rate limit"
```

### Health Checks

```bash
# All services health
for svc in control-plane gateway registry scanner; do
  echo "$svc: $(kubectl exec deploy/$svc -n mcp-manager -- curl -s localhost:300X/health)"
done
```

---

## Quick Reference

### Credentials Summary

| Credential | Where to Find |
|------------|---------------|
| `GITHUB_SCOPE_LEVEL` | `enterprise` or `organization` |
| `GITHUB_ENTERPRISE_NAME` | URL: `/enterprises/THIS-SLUG` |
| `GITHUB_ORG` | URL: `/organizations/THIS-NAME` |
| `GITHUB_API_URL` | `https://github.your-company.com/api/v3` |
| `GITHUB_APP_ID` | App settings page after creation |
| `GITHUB_PRIVATE_KEY` | Downloaded `.pem` file |
| `GITHUB_APP_INSTALLATION_ID` | URL after installing app |

### Service Ports

| Service | Internal Port | External |
|---------|--------------|----------|
| Admin UI | 3000 | `mcp.company.com` |
| Control Plane | 3001 | `mcp.company.com/api` |
| Registry | 3002 | `mcp-registry.company.com` |
| Gateway | 3003 | `mcp-gateway.company.com` |
| Scanner | 3004 | Internal only |

### Commands Cheat Sheet

```bash
# Deploy
kubectl apply -k k8s/overlays/production

# Logs
kubectl logs -f -l app=gateway -n mcp-manager

# Shell access
kubectl exec -it deploy/control-plane -n mcp-manager -- sh

# Database migration
kubectl exec deploy/control-plane -n mcp-manager -- npx prisma migrate deploy

# Force GitHub sync
curl -X POST http://mcp.company.com/api/v1/sync/github-copilot \
  -H "Authorization: Bearer $TOKEN"
```
