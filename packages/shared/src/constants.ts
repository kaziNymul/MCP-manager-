/**
 * MCP Manager Constants
 */

// Risk score thresholds
export const RISK_THRESHOLDS = {
  LOW: 30,
  MEDIUM: 60,
  HIGH: 80,
  CRITICAL: 100,
} as const;

// Dangerous tool patterns (blocked by default)
export const DANGEROUS_TOOL_PATTERNS = [
  /^exec$/i,
  /^shell$/i,
  /^eval$/i,
  /^run_command$/i,
  /^execute_command$/i,
  /^system$/i,
  /^spawn$/i,
  /^popen$/i,
  /delete.*all/i,
  /drop_/i,
  /truncate_/i,
  /destroy_/i,
  /wipe_/i,
  /format_/i,
  /rm_rf/i,
  /rmdir/i,
] as const;

// Dangerous capability keywords in descriptions
export const DANGEROUS_CAPABILITY_KEYWORDS = [
  'execute arbitrary',
  'run any command',
  'shell access',
  'system command',
  'delete all',
  'drop table',
  'truncate',
  'format disk',
  'admin access',
  'root access',
  'sudo',
  'superuser',
] as const;

// Write capability indicators
export const WRITE_CAPABILITY_PATTERNS = [
  /^create/i,
  /^insert/i,
  /^update/i,
  /^write/i,
  /^put/i,
  /^post/i,
  /^set/i,
  /^add/i,
  /^modify/i,
  /^edit/i,
  /^patch/i,
] as const;

// Delete capability indicators
export const DELETE_CAPABILITY_PATTERNS = [
  /^delete/i,
  /^remove/i,
  /^drop/i,
  /^truncate/i,
  /^destroy/i,
  /^purge/i,
  /^clear/i,
] as const;

// Rate limiting defaults
export const DEFAULT_RATE_LIMITS = {
  GLOBAL_WINDOW_MS: 60000,
  GLOBAL_MAX_REQUESTS: 100,
  PER_TOOL_WINDOW_MS: 60000,
  PER_TOOL_MAX_REQUESTS: 20,
  BURST_WINDOW_MS: 1000,
  BURST_MAX_REQUESTS: 10,
} as const;

// Scan timeouts
export const SCAN_TIMEOUTS = {
  CONNECT_MS: 5000,
  TOOLS_LIST_MS: 10000,
  TOOL_CALL_MS: 30000,
  TOTAL_SCAN_MS: 60000,
} as const;

// MCP JSON-RPC constants
export const MCP_JSONRPC = {
  VERSION: '2.0',
  PROTOCOL_VERSION: '2024-11-05',
} as const;

// Audit event types
export const AUDIT_EVENT_TYPES = {
  // Server lifecycle
  SERVER_REGISTERED: 'server.registered',
  SERVER_UPDATED: 'server.updated',
  SERVER_DELETED: 'server.deleted',
  
  // Version lifecycle
  VERSION_CREATED: 'version.created',
  VERSION_SCANNED: 'version.scanned',
  VERSION_APPROVED: 'version.approved',
  VERSION_REJECTED: 'version.rejected',
  VERSION_REVOKED: 'version.revoked',
  
  // Tool calls
  TOOLS_LIST: 'tools.list',
  TOOLS_CALL: 'tools.call',
  TOOLS_BLOCKED: 'tools.blocked',
  
  // Policy events
  POLICY_CREATED: 'policy.created',
  POLICY_UPDATED: 'policy.updated',
  POLICY_DELETED: 'policy.deleted',
  
  // Auth events
  AUTH_SUCCESS: 'auth.success',
  AUTH_FAILURE: 'auth.failure',
  
  // Admin actions
  EMERGENCY_REVOKE: 'admin.emergency_revoke',
} as const;

// Service ports
export const SERVICE_PORTS = {
  CONTROL_PLANE: 3001,
  REGISTRY: 3002,
  GATEWAY: 3003,
  SCANNER: 3004,
  ADMIN_UI: 3000,
} as const;
