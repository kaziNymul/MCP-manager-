# MCP Manager Workflow Diagram Explanation

This document explains the workflow diagram (`mcp-manager-workflow.png`) that illustrates how MCP Manager provides enterprise governance for Model Context Protocol (MCP) servers.

---

## Overview

The diagram shows the complete lifecycle of MCP server management, from initial registration through runtime enforcement. It is divided into **three main phases** plus supporting components for security, policies, and auditing.

---

## Phase 1: Server Registration

```
Admin → Control Plane API → PostgreSQL → Scan Job
```

### Flow:
1. **Admin registers MCP Server via UI** - An administrator or developer uses the Admin UI (port 3000) to register a new MCP server by providing its endpoint URL and metadata.

2. **Control Plane API creates record** - The Control Plane API (port 3001) receives the registration request and creates a new server record.

3. **PostgreSQL: Status PENDING** - The server is stored in the database with status `PENDING`, meaning it cannot be used yet.

4. **Create Scan Job** - A background scan job is created for the Scanner Worker to pick up.

### Key Point:
> No MCP server can be used until it passes the security scanning phase. This is the "Zero Trust" principle.

---

## Security Scanning

```
Scanner → Connect → tools/list → Analyze → Risk Score → Auto-Approve or Pending Review
```

### Flow:
1. **Scanner Worker polls jobs** - The Scanner service (port 3004) continuously polls the database for pending scan jobs.

2. **Connect to MCP Server** - Scanner establishes a connection to the registered MCP server endpoint.

3. **Call tools/list** - Scanner sends the MCP `tools/list` request to enumerate all available tools.

4. **Analyze tool names** - Tool names are checked against dangerous patterns:
   - `execute*`, `shell*`, `bash*` → CRITICAL risk
   - `write_file`, `delete*` → HIGH risk
   - `http_request`, `fetch*` → HIGH risk (SSRF potential)
   - `sql_query`, `db_exec*` → CRITICAL risk

5. **Check input schemas** - Each tool's input schema is analyzed for:
   - Missing validation on path/URL/command parameters
   - Overly permissive string inputs
   - Lack of enum constraints or pattern validation

6. **Detect vulnerabilities** - Combined analysis produces vulnerability findings:
   - Injection risks
   - SSRF potential
   - Missing authentication
   - Insecure defaults

7. **Compute Risk Score 0-100** - All findings are weighted to produce a final risk score:
   - 0-30: LOW risk
   - 31-50: MEDIUM risk
   - 51-70: HIGH risk
   - 71-100: CRITICAL risk

8. **Decision Point - Risk <= 30?**
   - **YES → AUTO-APPROVE**: Server is automatically approved and set to `ACTIVE` status
   - **NO → PENDING REVIEW**: Server requires manual review by an administrator

### Key Point:
> Only low-risk servers (score ≤ 30) are auto-approved. Higher risk servers require human review, ensuring dangerous tools are explicitly approved.

---

## Phase 2: Discovery

```
GitHub Copilot → Registry → Gateway URLs (not real endpoints!)
```

### Flow:
1. **GitHub Copilot queries Registry** - MCP clients like GitHub Copilot call `GET /v0.1/servers` on the Registry service (port 3002).

2. **Registry returns GATEWAY URLs** - The Registry returns a list of approved servers, but critically, the URLs point to the **Gateway**, not the real server endpoints.

3. **Not real server endpoints!** - This is the key security feature. Clients never connect directly to MCP servers.

### Example Response:
```json
{
  "servers": [
    {
      "name": "file-server",
      "url": "https://gateway.company.com/mcp/acme/file-server"
    }
  ]
}
```

### Key Point:
> By returning Gateway URLs instead of real endpoints, all traffic is forced through the security layer. Clients cannot bypass security checks.

---

## Phase 3: Runtime Gateway

```
Request → Auth → Anomaly → Threat → Tool Check → Policy → Schema → Proxy or Block
```

This is the **most critical security phase**. Every MCP request goes through 6 security checks.

### Security Checks (in order):

| # | Check | Purpose | Block Condition |
|---|-------|---------|-----------------|
| 1 | **JWT Authentication** | Verify user identity | Invalid/expired token |
| 2 | **Anomaly Detection** | Detect unusual behavior | High call rate, unusual patterns |
| 3 | **Threat Detection** | Detect malicious content | Prompt injection, command injection |
| 4 | **Dangerous Tool Check** | Block known-dangerous tools | Tool matches `exec*`, `shell*`, etc. |
| 5 | **Policy Evaluation** | Apply org/team policies | Policy denies the tool/action |
| 6 | **Schema Validation** | Validate tool arguments | Arguments don't match schema |

### Decision Point - All Passed?

**If ANY check fails:**
```
BLOCK - 403 Forbidden → Log to Audit Trail
```

**If ALL checks pass:**
```
Proxy to Backend → Scan Response → Log to Audit → Return Response
```

### Response Scanning:
Even after proxying, responses are scanned for:
- Credential leaks (API keys, tokens)
- PII exposure (SSN, credit cards)
- Sensitive data patterns

### Key Point:
> The Gateway is the enforcement point. It doesn't just log threats—it **actively blocks** them before they reach the backend server.

---

## Threats Blocked

The Threat Detection component identifies and blocks these attack types:

| Threat | Description | Example Pattern |
|--------|-------------|-----------------|
| **Prompt Injection** | Attempts to override AI instructions | "ignore previous instructions" |
| **Command Injection** | Shell command execution | `; rm -rf /`, `$(whoami)` |
| **Path Traversal** | Access files outside allowed paths | `../../../etc/passwd` |
| **SSRF Attacks** | Access internal network resources | `http://169.254.169.254` |
| **SQL Injection** | Database manipulation | `' OR '1'='1` |
| **Data Exfiltration** | Unauthorized data extraction | Large response to external URL |

---

## Policy Types

The Policy Engine supports multiple policy types:

| Policy Type | Description | Example |
|-------------|-------------|---------|
| **Tool Denylist** | Block tools matching patterns | Block all `execute*` tools |
| **Tool Allowlist** | Only allow specific tools | Allow only `read_file`, `search` |
| **Capability Gates** | Require approval for capabilities | Write operations need admin approval |
| **Rate Limits** | Limit call frequency | Max 100 calls/hour per user |

### Policy Evaluation Order:
1. Deny lists (highest priority)
2. Capability gates
3. Team-specific policies
4. Allow lists

**Deny always wins over Allow.**

---

## Audit Logging

Every action is logged to the audit trail:

| What's Logged | Details Captured |
|---------------|------------------|
| **All tool calls** | User, tool, arguments, response, duration |
| **Blocked requests** | Reason for block, policy that triggered |
| **Full request/response** | Complete payload for forensics |

### Audit Use Cases:
- Compliance reporting
- Security incident investigation
- Usage analytics
- Cost allocation

---

## Complete Flow Example

Here's a complete example of the workflow:

### 1. Registration
```
Developer registers "code-analyzer" server
→ Endpoint: https://internal-server:8080
→ Status: PENDING
```

### 2. Scanning
```
Scanner connects to server
→ Finds tools: analyze_code, search_codebase, execute_command
→ "execute_command" triggers CRITICAL risk flag
→ Risk Score: 65 (HIGH)
→ Status: PENDING_REVIEW
```

### 3. Admin Review
```
Admin reviews server in UI
→ Sees "execute_command" flagged as dangerous
→ Creates policy to block "execute_command"
→ Approves server with policy attached
```

### 4. Discovery
```
GitHub Copilot queries registry
→ Gets URL: gateway.company.com/mcp/acme/code-analyzer
```

### 5. Runtime
```
Developer uses Copilot to call "analyze_code"
→ Gateway authenticates user
→ All security checks pass
→ Request proxied to backend
→ Response returned to developer
```

### 6. Blocked Attempt
```
Attacker tries to call "execute_command"
→ Gateway authenticates user
→ Dangerous Tool Check: BLOCKED (matches pattern)
→ 403 Forbidden returned
→ Audit log: BLOCKED, reason: "Tool matches dangerous pattern"
```

---

## Summary

The MCP Manager workflow provides **defense in depth**:

1. **Registration-time**: Servers must be scanned before use
2. **Scan-time**: Dangerous tools are identified and risk-scored
3. **Approval-time**: High-risk servers require human review
4. **Discovery-time**: Clients receive Gateway URLs, not real endpoints
5. **Runtime**: Every request passes through 6 security checks
6. **Post-request**: Responses are scanned for leaks
7. **Always**: Complete audit trail is maintained

This ensures that no MCP server can be used without proper vetting, and no request can reach a server without passing security validation.

---

*Diagram Source: `mcp-manager-workflow.mmd`*
*Last Updated: January 2026*
