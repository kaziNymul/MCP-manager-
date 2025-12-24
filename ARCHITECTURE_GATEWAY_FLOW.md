# MCP Gateway Architecture & Request Flow

## 1. WHERE IS THE MCP GATEWAY?

### Deployment Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         KUBERNETES CLUSTER                              │
│                      (Production Deployment)                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    MCP Manager Namespace                         │   │
│  │                                                                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │   │
│  │  │  Admin UI    │  │ Control Plane│  │   Registry   │          │   │
│  │  │ (port 3000)  │  │  (port 3001) │  │  (port 3002) │          │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │   │
│  │         ▲                    ▲                ▲                 │   │
│  │         │                    │                │                 │   │
│  │         └────────────────────┼────────────────┘                 │   │
│  │                              │                                  │   │
│  │                    ┌─────────▼──────────┐                      │   │
│  │                    │   PostgreSQL DB    │                      │   │
│  │                    └────────────────────┘                      │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │              🔑 MCP GATEWAY (Data Plane)                │  │   │
│  │  │                 ⭐ PORT 3003 ⭐                          │  │   │
│  │  │                                                          │  │   │
│  │  │  K8s Service: gateway:3003                              │  │   │
│  │  │  Replicas: 3 (for HA)                                   │  │   │
│  │  │  Internal Address: gateway.mcp-manager.svc.cluster.local│  │   │
│  │  │  Public Address: Usually behind Ingress/ALB             │  │   │
│  │  │                                                          │  │   │
│  │  │  ┌──────────────────────────────────────┐              │  │   │
│  │  │  │ POST /mcp/{org}/{server}            │              │  │   │
│  │  │  │ (Main JSON-RPC endpoint)            │              │  │   │
│  │  │  └──────────────────────────────────────┘              │  │   │
│  │  │                                                          │  │   │
│  │  │  ┌──────────────────────────────────────┐              │  │   │
│  │  │  │ GET /mcp/{org}/{server}/sse         │              │  │   │
│  │  │  │ (Server-Sent Events endpoint)       │              │  │   │
│  │  │  └──────────────────────────────────────┘              │  │   │
│  │  └──────────────────────────────────────────────────────────┘  │   │
│  │                         ▲                                      │   │
│  │                         │                                      │   │
│  │                    (Proxies to)                               │   │
│  │                         │                                      │   │
│  └─────────────────────────┼──────────────────────────────────────┘   │
│                            │                                           │
│                            │  Kubernetes Network                       │
│                            │  (Internal Traffic)                       │
│                            │                                           │
└────────────────────────────┼───────────────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
    ┌────▼─────┐                          ┌────▼─────┐
    │ MCP       │                          │ MCP      │
    │ Server 1  │                          │ Server N │
    │ (port     │                          │ (port    │
    │ 8000-8999)│                          │ 8000-8999)
    │           │                          │          │
    │ Tools:    │                          │ Tools:   │
    │ - execute │                          │ - query  │
    │ - analyze │                          │ - fetch  │
    └───────────┘                          └──────────┘

OUTSIDE THE CLUSTER:
┌────────────────┐
│ GitHub Copilot │
│  Enterprise    │
└────────────────┘
         ▲
         │ Whitelist contains Gateway URL
         │ https://gateway.company.com/mcp/{org}/{server}
         │
  ┌──────┴───────────────────────┐
  │ Ingress / Load Balancer       │
  │ (Terminates TLS)              │
  └───────────────────────────────┘
```

### Local Development Setup

```
Your Machine (localhost):
  │
  ├─ http://localhost:3000  → Admin UI
  ├─ http://localhost:3001  → Control Plane
  ├─ http://localhost:3002  → Registry
  ├─ http://localhost:3003  → 🔑 MCP GATEWAY (Port 3003)
  │  
  └─ http://localhost:3004  → Scanner

Docker Compose Example:
  gateway:
    image: mcp-manager/gateway
    ports:
      - "3003:3003"
    environment:
      - DATABASE_URL=postgres://user:pass@postgres:5432/mcp
      - GATEWAY_URL=http://localhost:3003
```

---

## 2. HOW DOES GATEWAY FORWARD REQUESTS TO MCP SERVERS?

### Step-by-Step Request Flow

```
1. REQUEST ARRIVES AT GATEWAY
   ┌─────────────────────────────────┐
   │ GitHub Copilot Client           │
   │ sends JSON-RPC tool call        │
   └────────────────┬────────────────┘
                    │
                    ▼
   POST /mcp/acme/my-analyzer
   {
     "jsonrpc": "2.0",
     "id": "123",
     "method": "tools/call",
     "params": {
       "name": "analyze_code",
       "arguments": { "code": "..." }
     }
   }

2. GATEWAY AUTHENTICATES & RESOLVES SERVER
   ┌──────────────────────────────────────────────────┐
   │ Gateway receives request                         │
   │ - Verifies JWT token                             │
   │ - Extracts org slug: "acme"                       │
   │ - Extracts server slug: "my-analyzer"            │
   │ - Looks up in database:                          │
   │   SELECT * FROM servers                          │
   │   WHERE name LIKE '%/my-analyzer'                │
   │   AND org.slug = 'acme'                          │
   │   AND status = 'ACTIVE'                          │
   └────────────┬─────────────────────────────────────┘
                │
                ▼
   Server found! Database returns:
   {
     "id": "srv_123",
     "name": "acme/my-analyzer",
     "endpoint": "http://192.168.1.100:8001",  ← ACTUAL SERVER URL
     "status": "ACTIVE",
     "versions": [{
       "id": "v_456",
       "endpoint": "http://192.168.1.100:8001",
       "status": "APPROVED",
       "toolSchemas": [...]
     }]
   }

3. SECURITY CHECKS (4 layers)
   ┌──────────────────────────────────────────────────┐
   │ CHECK 1: Anomaly Detection                       │
   │ - Rate limiting (calls/min)                      │
   │ - Behavioral analysis (unusual patterns)         │
   │ → Decision: ALLOW / BLOCK                        │
   └──────────────────────────────────────────────────┘
                    ▼
   ┌──────────────────────────────────────────────────┐
   │ CHECK 2: Request Threat Detection                │
   │ - Prompt injection patterns                      │
   │ - Command injection                              │
   │ - SQL injection, Path traversal, SSRF            │
   │ → Decision: ALLOW / BLOCK                        │
   └──────────────────────────────────────────────────┘
                    ▼
   ┌──────────────────────────────────────────────────┐
   │ CHECK 3: Argument Validation                     │
   │ - Validate against tool's inputSchema (JSON      │
   │   Schema)                                        │
   │ - Check tool is in allowlist                     │
   │ → Decision: ALLOW / BLOCK                        │
   └──────────────────────────────────────────────────┘
                    ▼
   ┌──────────────────────────────────────────────────┐
   │ CHECK 4: Policy Engine                           │
   │ - Time-based access control                      │
   │ - Organization/team policies                     │
   │ - Custom approval rules                          │
   │ → Decision: ALLOW / BLOCK                        │
   └──────────────────────────────────────────────────┘
                    ▼

4. PROXY REQUEST TO ACTUAL MCP SERVER
   ┌──────────────────────────────────────────────────┐
   │ McpProxy.proxyToolCall()                         │
   │ from [gateway/src/services/mcp-proxy.ts]        │
   │                                                  │
   │ Makes HTTP POST to:                              │
   │ http://192.168.1.100:8001                        │
   │                                                  │
   │ With same JSON-RPC request:                      │
   │ {                                                │
   │   "jsonrpc": "2.0",                              │
   │   "id": "123",                                   │
   │   "method": "tools/call",                        │
   │   "params": { "name": "analyze_code", ... }      │
   │ }                                                │
   └────────────┬───────────────────────────────────┘
                │
                ▼
   MCP Server processes request
   (takes 2-5 seconds)
                │
                ▼
   Returns JSON-RPC response
   {
     "jsonrpc": "2.0",
     "id": "123",
     "result": {
       "issues": [...],
       "score": 85
     }
   }

5. RESPONSE THREAT DETECTION (CHECK 5)
   ┌──────────────────────────────────────────────────┐
   │ threatDetector.analyzeToolResponse()             │
   │ - Scans for credential leaks                     │
   │ - Checks for PII exposure (SSN, credit cards)    │
   │ - Detects private keys/certificates              │
   │ → Result: FLAGGED for review or SUCCESS          │
   │ → NOTE: Detection only, does NOT block           │
   └──────────────────────────────────────────────────┘
                │
                ▼

6. AUDIT LOG (DATABASE WRITE)
   ┌──────────────────────────────────────────────────┐
   │ CREATE audit_event:                              │
   │ {                                                │
   │   "userId": "user_123",                          │
   │   "orgId": "org_acme",                           │
   │   "toolName": "analyze_code",                    │
   │   "serverName": "acme/my-analyzer",              │
   │   "correlationId": "corr_789",                   │
   │   "status": "SUCCESS",                           │
   │   "durationMs": 2500,                            │
   │   "metadata": {                                  │
   │     "responseThreats": [],                       │
   │     "ipAddress": "203.0.113.42",                 │
   │     "userAgent": "..."                           │
   │   }                                              │
   │ }                                                │
   └──────────────────────────────────────────────────┘
                │
                ▼

7. RETURN RESPONSE TO CLIENT
   ┌──────────────────────────────────────────────────┐
   │ Gateway returns to GitHub Copilot:               │
   │ {                                                │
   │   "jsonrpc": "2.0",                              │
   │   "id": "123",                                   │
   │   "result": { "issues": [...], "score": 85 }     │
   │ }                                                │
   └──────────────────────────────────────────────────┘
                │
                ▼
   GitHub Copilot shows results to user
```

---

## 3. WHAT URL GETS WHITELISTED?

### The Critical Difference

#### ❌ BEFORE (Direct URL - BUG WE FIXED)

```
Server Registration:
  MCP Manager Admin: "Register my analyzer server"
  Stored endpoint: http://192.168.1.100:8001
  
Server Approval (OLD CODE - BROKEN):
  // apps/control-plane/src/routes/servers.ts line 427 (BEFORE)
  await githubCopilot.addServer({
    name: "my-analyzer",
    url: version.endpoint || server.endpoint,  ❌ SENDS DIRECT URL!
  });
  
GitHub Copilot Whitelist gets:
  ✗ http://192.168.1.100:8001
  
Client Flow (NO INSPECTION):
  GitHub Copilot → http://192.168.1.100:8001 (DIRECT)
         └─ NO GATEWAY = NO AUDIT, NO POLICY CHECKS, NO THREAT DETECTION
```

#### ✅ AFTER (Gateway URL - FIXED)

```
Server Registration:
  MCP Manager Admin: "Register my analyzer server"
  Stored endpoint: http://192.168.1.100:8001
  
Server Approval (NEW CODE - CORRECT):
  // apps/control-plane/src/routes/servers.ts line 426 (AFTER)
  const gatewayUrl = buildGatewayUrl(server.org.slug, server.name);
  // Result: "http://gateway.company.com/mcp/acme/my-analyzer"
  
  await githubCopilot.addServer({
    name: "my-analyzer",
    url: gatewayUrl,  ✅ SENDS GATEWAY URL!
  });
  
GitHub Copilot Whitelist gets:
  ✓ https://gateway.company.com/mcp/acme/my-analyzer
  
Client Flow (WITH INSPECTION):
  GitHub Copilot → Gateway (all checks) → MCP Server
         └─ FULL AUDIT, POLICY ENFORCEMENT, THREAT DETECTION
```

### URL Building Logic

```typescript
// From gateway/src/routes/servers.ts

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3003';

function buildGatewayUrl(orgSlug: string, serverName: string): string {
  // serverName format: "organization/server-name"
  // Extract the slug part (after the /)
  const serverSlug = serverName.includes('/') 
    ? serverName.split('/')[1] 
    : serverName;
  
  // Build: {GATEWAY_URL}/mcp/{org}/{server}
  return `${GATEWAY_URL}/mcp/${orgSlug}/${serverSlug}`;
}

// Example:
// Input: orgSlug="acme", serverName="acme/my-analyzer"
// Output: "https://gateway.company.com/mcp/acme/my-analyzer"
```

### Database Storage

```
Database (PostgreSQL):

servers table:
┌────┬──────────────────────┬─────────────────────────────────┐
│ id │ name                 │ endpoint                        │
├────┼──────────────────────┼─────────────────────────────────┤
│ 1  │ acme/my-analyzer     │ http://192.168.1.100:8001      │
│ 2  │ acme/data-processor  │ http://192.168.1.101:8002      │
│ 3  │ beta/code-reviewer   │ http://203.0.113.5:8003        │
└────┴──────────────────────┴─────────────────────────────────┘
     ▲                        ▲
     │                        │
     │                  Actual MCP server address
     │
     Registered name

github_copilot_whitelist (External to MCP Manager):
┌──────────────────────────────────────────────────────────────┐
│ name          │ url                                          │
├───────────────┼──────────────────────────────────────────────┤
│ my-analyzer   │ https://gateway.company.com/mcp/acme/my-... │
│ data-processor│ https://gateway.company.com/mcp/acme/data...│
│ code-reviewer │ https://gateway.company.com/mcp/beta/code...│
└───────────────┴──────────────────────────────────────────────┘
                ▲
                │
                Gateway URLs (not direct server URLs!)
```

---

## 4. TWO-LEVEL URL ARCHITECTURE

```
┌────────────────────────────────────────────────────────────────┐
│  LEVEL 1: MCP Manager Internal                                │
│                                                                │
│  Database stores ACTUAL SERVER URLS:                           │
│  - http://192.168.1.100:8001 (internal network)              │
│  - Accessible only from within cluster                        │
│  - Registered by admins during server setup                   │
└────────────────────────────────────────────────────────────────┘
         ▲
         │ Gateway knows these
         │ and uses them to proxy
         │
┌────────────────────────────────────────────────────────────────┐
│  LEVEL 2: GitHub Copilot (External)                           │
│                                                                │
│  Whitelist contains GATEWAY URLs:                              │
│  - https://gateway.company.com/mcp/acme/my-analyzer          │
│  - Accessible from public internet                            │
│  - All traffic flows through Gateway for inspection            │
└────────────────────────────────────────────────────────────────┘
```

---

## 5. SECURITY IMPLICATIONS

```
✅ WHAT GATEWAY INSPECTION PROVIDES
  ✓ Audit trail of all tool invocations
  ✓ Real-time threat detection on inputs
  ✓ Behavioral anomaly detection
  ✓ Response inspection for credential leaks
  ✓ Policy enforcement at runtime
  ✓ Rate limiting per user/server
  ✓ Correlation IDs for tracing

❌ WHAT WOULD HAPPEN WITHOUT GATEWAY
  ✗ GitHub Copilot connects directly to MCP server
  ✗ No audit trail in MCP Manager
  ✗ No threat detection
  ✗ No policy enforcement
  ✗ No way to revoke access instantly
  ✗ No behavioral monitoring
  ✗ Direct server exposed to GitHub Copilot users
```

---

## 6. RUNTIME FLOW: USER WORKING WITH WHITELISTED SERVER

### The Complete User Journey

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     GITHUB COPILOT (User's Machine)                    │
│                                                                          │
│  User is coding:                                                        │
│  "Hey Copilot, analyze this code for vulnerabilities"                  │
│                                                                          │
│  Copilot invokes: my-analyzer tool                                     │
└────────────────┬─────────────────────────────────────────────────────────┘
                 │
                 │  GitHub Copilot constructs MCP request:
                 │  {
                 │    "jsonrpc": "2.0",
                 │    "id": "req_abc123",
                 │    "method": "tools/call",
                 │    "params": {
                 │      "name": "analyze_code",
                 │      "arguments": {
                 │        "code": "[user's code snippet]"
                 │      }
                 │    }
                 │  }
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│     GITHUB COPILOT MAKES HTTP REQUEST                                  │
│     TO WHITELISTED SERVER URL:                                          │
│                                                                          │
│     POST https://gateway.company.com/mcp/acme/my-analyzer              │
│     Header: Authorization: Bearer <copilot-token>                       │
│                                                                          │
│     (NOT to http://192.168.1.100:8001 - the direct server!)            │
└────────────────┬─────────────────────────────────────────────────────────┘
                 │
                 │  Request travels over INTERNET
                 │  ↓
                 │  (TLS/SSL encrypted)
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│        🔑 MCP GATEWAY (port 3003)                                       │
│        ══════════════════════════════════════════════════════════════   │
│                                                                          │
│  STEP 1: ROUTE MATCHING                                                │
│  GET request path: /mcp/acme/my-analyzer                              │
│  Extract: org="acme", server="my-analyzer"                            │
│                                                                          │
│  STEP 2: AUTHENTICATION                                                │
│  Verify JWT token is valid and user belongs to org "acme"             │
│  ✓ Token is valid                                                      │
│  ✓ User is in organization "acme"                                      │
│                                                                          │
│  STEP 3: SERVER LOOKUP (DATABASE QUERY)                               │
│  SELECT * FROM servers                                                 │
│  WHERE name LIKE '%/my-analyzer'                                       │
│    AND org.slug = 'acme'                                               │
│    AND status = 'ACTIVE'                                               │
│    AND version.status = 'APPROVED'                                     │
│                                                                          │
│  Database returns:                                                      │
│  {                                                                       │
│    "id": "srv_123",                                                     │
│    "name": "acme/my-analyzer",                                          │
│    "endpoint": "http://192.168.1.100:8001",  ← ACTUAL SERVER URL      │
│    "version": {                                                         │
│      "endpoint": "http://192.168.1.100:8001",                          │
│      "toolSchemas": [                                                   │
│        {                                                                │
│          "name": "analyze_code",                                        │
│          "inputSchema": { ... },                                        │
│          "capabilities": ["analysis"],                                  │
│          "isDangerous": false                                           │
│        }                                                                │
│      ]                                                                  │
│    }                                                                    │
│  }                                                                       │
│                                                                          │
│  STEP 4: SECURITY CHECKS (5 Layers)                                   │
│                                                                          │
│  ┌─ CHECK 1: Anomaly Detection ──────────────────────────────┐        │
│  │ User: john@acme.com                                       │        │
│  │ Tool: analyze_code                                        │        │
│  │ Rate: 3 calls in last minute                              │        │
│  │ Behavioral: Normal pattern for this user                  │        │
│  │ ✅ PASS                                                    │        │
│  └───────────────────────────────────────────────────────────┘        │
│                        ▼                                                │
│  ┌─ CHECK 2: Request Threat Detection ───────────────────────┐        │
│  │ Scanning arguments for:                                   │        │
│  │ - Prompt injection patterns: ❌ NOT FOUND                  │        │
│  │ - Command injection: ❌ NOT FOUND                          │        │
│  │ - SQL injection: ❌ NOT FOUND                              │        │
│  │ - Path traversal: ❌ NOT FOUND                             │        │
│  │ ✅ PASS                                                    │        │
│  └───────────────────────────────────────────────────────────┘        │
│                        ▼                                                │
│  ┌─ CHECK 3: Argument Validation ────────────────────────────┐        │
│  │ Tool's inputSchema:                                       │        │
│  │ {                                                         │        │
│  │   "type": "object",                                       │        │
│  │   "properties": {                                         │        │
│  │     "code": { "type": "string", "maxLength": 10000 }      │        │
│  │   },                                                      │        │
│  │   "required": ["code"]                                    │        │
│  │ }                                                         │        │
│  │ Arguments: { "code": "[user code]" }                      │        │
│  │ ✅ PASS (matches schema)                                   │        │
│  └───────────────────────────────────────────────────────────┘        │
│                        ▼                                                │
│  ┌─ CHECK 4: Policy Engine ──────────────────────────────────┐        │
│  │ Checking policies for org "acme":                         │        │
│  │ - Time-based: Allow 9 AM - 6 PM: ✅ PASS (2 PM)           │        │
│  │ - Rate limit: Max 100/hour: ✅ PASS (3 calls)             │        │
│  │ - Tool allowlist: analyze_code allowed? ✅ PASS           │        │
│  │ - Team access: User in team "backend"? ✅ PASS            │        │
│  │ ✅ PASS                                                    │        │
│  └───────────────────────────────────────────────────────────┘        │
│                        ▼                                                │
│  STEP 5: PROXY REQUEST TO ACTUAL MCP SERVER                            │
│                                                                          │
│  McpProxy.proxyToolCall() makes HTTP POST to:                          │
│  http://192.168.1.100:8001                                            │
│                                                                          │
│  (Note: This is INTERNAL NETWORK, not accessible from internet)        │
│  (Gateway is inside the firewall/VPN)                                  │
│                                                                          │
│  POST /                                                                 │
│  {                                                                       │
│    "jsonrpc": "2.0",                                                    │
│    "id": "req_abc123",                                                  │
│    "method": "tools/call",                                              │
│    "params": {                                                          │
│      "name": "analyze_code",                                            │
│      "arguments": { "code": "[user's code]" }                          │
│    }                                                                    │
│  }                                                                       │
│                                                                          │
│  Gateway waits for response...                                         │
│  (Timeout: 30 seconds)                                                 │
└────────────────┬─────────────────────────────────────────────────────────┘
                 │
                 │  Request travels through INTERNAL NETWORK
                 │  (VPC, direct connection, no internet)
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│       🖥️  ACTUAL MCP SERVER (port 8001)                                 │
│       ════════════════════════════════════════════════════════════════  │
│                                                                          │
│  Receives JSON-RPC request                                             │
│  Parses: method="tools/call", tool="analyze_code"                      │
│  Arguments: code="[user's code]"                                       │
│                                                                          │
│  Executes tool logic:                                                  │
│  1. Parse code                                                         │
│  2. Run static analysis                                                │
│  3. Run security checks                                                │
│  4. Compile results                                                    │
│                                                                          │
│  Takes: ~2-3 seconds                                                   │
│                                                                          │
│  Returns JSON-RPC response:                                            │
│  {                                                                       │
│    "jsonrpc": "2.0",                                                    │
│    "id": "req_abc123",                                                  │
│    "result": {                                                          │
│      "issues": [                                                        │
│        {                                                                │
│          "line": 42,                                                    │
│          "severity": "HIGH",                                            │
│          "message": "SQL injection vulnerability",                      │
│          "suggestion": "Use parameterized queries"                      │
│        }                                                                │
│      ],                                                                 │
│      "score": 62,                                                       │
│      "timestamp": "2025-12-23T14:30:45Z"                               │
│    }                                                                    │
│  }                                                                       │
└────────────────┬─────────────────────────────────────────────────────────┘
                 │
                 │  Response travels back to Gateway
                 │  (Internal network)
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│        🔑 MCP GATEWAY (Processing Response)                             │
│        ═════════════════════════════════════════════════════════════   │
│                                                                          │
│  STEP 6: RESPONSE THREAT DETECTION (CHECK 5)                           │
│                                                                          │
│  threatDetector.analyzeToolResponse()                                   │
│                                                                          │
│  Scanning response for:                                                │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │ - API Keys (sk-, ghp_, AKIA): ❌ NOT FOUND                  │       │
│  │ - Database credentials: ❌ NOT FOUND                         │       │
│  │ - Private keys: ❌ NOT FOUND                                 │       │
│  │ - Credit card numbers: ❌ NOT FOUND                          │       │
│  │ - SSN patterns: ❌ NOT FOUND                                 │       │
│  │ - Connection strings: ❌ NOT FOUND                           │       │
│  │ ✅ SAFE - No sensitive data detected                         │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                          │
│  STEP 7: AUDIT LOGGING (DATABASE WRITE)                               │
│                                                                          │
│  INSERT INTO audit_events:                                             │
│  {                                                                       │
│    "correlationId": "corr_789xyz",                                      │
│    "userId": "user_john",                                               │
│    "orgId": "org_acme",                                                 │
│    "eventType": "TOOLS_CALL",                                           │
│    "action": "invoke",                                                  │
│    "toolName": "analyze_code",                                          │
│    "serverName": "acme/my-analyzer",                                    │
│    "status": "SUCCESS",                                                 │
│    "arguments": "[SANITIZED]",                                          │
│    "durationMs": 2450,                                                  │
│    "ipAddress": "203.0.113.42",                                         │
│    "userAgent": "Copilot-AI-Agent/1.0",                                │
│    "metadata": {                                                        │
│      "anomalyScore": 0.1,                                               │
│      "responseThreats": [],                                             │
│      "inputThreats": []                                                 │
│    },                                                                   │
│    "createdAt": "2025-12-23T14:30:47Z"                                 │
│  }                                                                       │
│                                                                          │
│  STEP 8: SEND RESPONSE TO CLIENT                                       │
│                                                                          │
│  Return JSON-RPC response to GitHub Copilot:                           │
│  {                                                                       │
│    "jsonrpc": "2.0",                                                    │
│    "id": "req_abc123",                                                  │
│    "result": {                                                          │
│      "issues": [ { "line": 42, "severity": "HIGH", ... } ],            │
│      "score": 62,                                                       │
│      "timestamp": "2025-12-23T14:30:45Z"                               │
│    }                                                                    │
│  }                                                                       │
└────────────────┬─────────────────────────────────────────────────────────┘
                 │
                 │  Response travels over INTERNET (TLS encrypted)
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               GITHUB COPILOT (User's Machine)                          │
│                                                                          │
│  Receives response with vulnerability findings                         │
│                                                                          │
│  Copilot displays to user:                                             │
│  "I found a potential SQL injection on line 42.                        │
│   Consider using parameterized queries."                               │
│                                                                          │
│  User sees results and fixes the vulnerability                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Time Breakdown

```
Step 1-2: Route + Auth           100 ms
Step 3:   DB lookup              50 ms
Step 4:   Security checks        150 ms
Step 5:   Proxy to server        2200 ms
Step 6:   Response analysis      50 ms
Step 7:   Audit logging          80 ms
──────────────────────────────────────
TOTAL LATENCY                   2630 ms (≈2.6 seconds)
```

### Key Points

✅ **All traffic goes through Gateway**
  - Request from Copilot → Gateway → Server
  - Response from Server → Gateway → Copilot

✅ **GitHub Copilot never knows the actual server location**
  - Only knows: https://gateway.company.com/mcp/acme/my-analyzer
  - Actual location: http://192.168.1.100:8001 (hidden from Copilot)

✅ **Full audit trail is maintained**
  - Every tool call logged in `audit_events` table
  - Includes timing, threats detected, user info, IP address

✅ **Instant access revocation possible**
  - If server compromised: Set status to REVOKED
  - Gateway blocks all future requests
  - GitHub Copilot whitelist updated automatically

✅ **Security enforcement at runtime**
  - Not just at approval time
  - Active checks on EVERY request
  - Anomaly detection learns user behavior

---

## 7. PRODUCTION DEPLOYMENT CHECKLIST

```
□ Set GATEWAY_URL environment variable:
  - Local: "http://localhost:3003"
  - Staging: "https://gateway-staging.company.com"
  - Production: "https://gateway.company.com"

□ Configure Ingress/Load Balancer:
  - Route /mcp/* to gateway service (port 3003)
  - Enable TLS/SSL
  - Optional: WAF rules for MCP traffic

□ Database has actual server endpoints:
  - Server 1: http://internal-mcp-1:8000
  - Server 2: http://internal-mcp-2:8000
  - These IPs/hostnames unknown to GitHub Copilot

□ GitHub Copilot configured with:
  - Enterprise/Org: your-company
  - API token with MCP server management permissions
  - Allowlist automatically synced on approval

□ Monitor gateway metrics:
  - Request latency (p99 < 2s)
  - Threat detection rates
  - Anomaly detections
  - Error rates
```
