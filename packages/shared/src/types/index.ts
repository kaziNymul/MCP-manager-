/**
 * Common TypeScript types for MCP Manager
 */

// User context passed through authenticated requests
export interface UserContext {
  userId: string;
  email: string;
  orgId: string;
  orgSlug: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  teams: Array<{
    teamId: string;
    teamName: string;
    role: 'LEAD' | 'MEMBER' | 'VIEWER';
  }>;
  // AD group-based permissions
  adGroups?: string[];
  isAdmin?: boolean;  // true if in admin AD group
  permissions?: string[];  // derived permissions from AD groups
}

// Service context for internal service-to-service calls
export interface ServiceContext {
  serviceId: string;
  serviceName: string;
  permissions: string[];
}

// Combined auth context
export type AuthContext = 
  | { type: 'user'; user: UserContext }
  | { type: 'service'; service: ServiceContext }
  | { type: 'anonymous' };

// Pagination options
export interface PaginationOptions {
  limit: number;
  offset: number;
}

// Paginated response
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// Server with version info for registry
export interface RegistryServerEntry {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  endpoint: string;
  transport: string;
  capabilities: string[];
  tools: Array<{
    name: string;
    description?: string;
  }>;
}

// Policy evaluation result
export interface PolicyEvaluationResult {
  allowed: boolean;
  reason?: string;
  policyName?: string;
  policyType?: string;
  requiresApproval?: boolean;
}

// Tool call context for policy evaluation
export interface ToolCallContext {
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  user: UserContext;
  teamId?: string;
  correlationId: string;
}

// Scan result from scanner
export interface ScanResult {
  success: boolean;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
  }>;
  riskAssessment: {
    score: number;
    level: string;
    flags: string[];
    warnings: string[];
    capabilities: string[];
    vulnerabilities?: Array<{
      id: string;
      type: string;
      severity: string;
      title: string;
    }>;
    securityScore?: number;
  };
  error?: string;
  scannedAt: string;
}

// Re-export security types
export type {
  ThreatDetectionResult,
  DetectedThreat,
  ThreatType,
} from '../security/threat-detector.js';

export type {
  AnomalyResult,
  DetectedAnomaly,
  AnomalyType,
} from '../security/anomaly-detector.js';

export type {
  VulnerabilityScanResult,
  Vulnerability,
  VulnerabilityType,
} from '../security/vulnerability-scanner.js';
