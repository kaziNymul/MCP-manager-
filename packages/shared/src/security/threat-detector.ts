/**
 * Real-time threat detection for MCP traffic.
 * Analyzes tool calls and responses for security threats.
 */

export interface ThreatDetectionResult {
  isThreat: boolean;
  threatLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  threats: DetectedThreat[];
  shouldBlock: boolean;
  requiresReview: boolean;
}

export interface DetectedThreat {
  type: ThreatType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  evidence: string;
  mitigation?: string;
}

export type ThreatType =
  | 'PROMPT_INJECTION'
  | 'JAILBREAK_ATTEMPT'
  | 'DATA_EXFILTRATION'
  | 'SENSITIVE_DATA_EXPOSURE'
  | 'COMMAND_INJECTION'
  | 'PATH_TRAVERSAL'
  | 'SSRF_ATTEMPT'
  | 'SQL_INJECTION'
  | 'CODE_INJECTION'
  | 'CREDENTIAL_LEAK'
  | 'PII_EXPOSURE'
  | 'ANOMALOUS_BEHAVIOR';

// ============================================================================
// PROMPT INJECTION DETECTION
// ============================================================================

const PROMPT_INJECTION_PATTERNS = [
  // Direct instruction overrides
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(everything|all|your)\s+(instructions?|rules?|training)/i,
  
  // Role manipulation
  /you\s+are\s+(now|actually)\s+(a|an|the)/i,
  /pretend\s+(you('re| are)|to\s+be)/i,
  /act\s+as\s+(if\s+you('re| are)|a|an|the)/i,
  /roleplay\s+as/i,
  /imagine\s+you('re| are)/i,
  
  // System prompt extraction
  /what\s+(are|is)\s+your\s+(instructions?|system\s+prompt|rules?)/i,
  /show\s+(me\s+)?your\s+(system\s+)?prompt/i,
  /reveal\s+your\s+(instructions?|programming)/i,
  /print\s+your\s+(instructions?|system\s+prompt)/i,
  
  // Jailbreak patterns
  /do\s+anything\s+now/i,
  /\bDAN\b.*mode/i,
  /bypass\s+(your\s+)?(safety|security|restrictions?)/i,
  /unlock\s+(your\s+)?(full|hidden)\s+(capabilities|potential)/i,
  /developer\s+mode\s+(enabled|on|activated)/i,
  
  // Delimiter injection
  /```system/i,
  /<\|im_start\|>/i,
  /<\|system\|>/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  
  // Encoded attacks
  /base64[:\s]*(decode|eval)/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
];

const JAILBREAK_INDICATORS = [
  'DAN mode',
  'jailbreak',
  'bypass restrictions',
  'no ethical guidelines',
  'no safety measures',
  'unrestricted mode',
  'god mode',
  'sudo mode',
  'admin override',
];

// ============================================================================
// DATA EXFILTRATION DETECTION
// ============================================================================

const SENSITIVE_DATA_PATTERNS = [
  // API Keys and Tokens
  { pattern: /\b(api[_-]?key|apikey)\s*[:=]\s*['"]?[\w-]{20,}['"]?/gi, type: 'API_KEY' },
  { pattern: /\bsk-[a-zA-Z0-9]{32,}/g, type: 'OPENAI_API_KEY' },
  { pattern: /\bghp_[a-zA-Z0-9]{36}/g, type: 'GITHUB_TOKEN' },
  { pattern: /\bglpat-[a-zA-Z0-9\-_]{20,}/g, type: 'GITLAB_TOKEN' },
  { pattern: /\bxox[baprs]-[a-zA-Z0-9-]{10,}/g, type: 'SLACK_TOKEN' },
  { pattern: /\bAKIA[A-Z0-9]{16}/g, type: 'AWS_ACCESS_KEY' },
  
  // Secrets
  { pattern: /\b(secret|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi, type: 'SECRET' },
  { pattern: /\bBEARER\s+[a-zA-Z0-9\-._~+/]+=*/gi, type: 'BEARER_TOKEN' },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, type: 'PRIVATE_KEY' },
  { pattern: /-----BEGIN\s+CERTIFICATE-----/g, type: 'CERTIFICATE' },
  
  // PII
  { pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, type: 'SSN' },
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, type: 'CREDIT_CARD' },
  { pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g, type: 'IBAN' },
  
  // Connection strings
  { pattern: /\b(mongodb|postgres|mysql|redis):\/\/[^\s]+/gi, type: 'CONNECTION_STRING' },
  { pattern: /\bServer\s*=.*;\s*Database\s*=/gi, type: 'SQL_CONNECTION_STRING' },
];

// ============================================================================
// COMMAND INJECTION DETECTION
// ============================================================================

const COMMAND_INJECTION_PATTERNS = [
  // Shell metacharacters
  /[;&|`$]|\$\(|\)\s*{/,
  /\|\s*\w+/,  // Pipe to command
  
  // Common dangerous commands
  /\b(rm|del|format|mkfs|dd|chmod\s+777|curl|wget|nc|netcat|bash|sh|zsh|powershell)\b.*[-\/]/i,
  
  // Reverse shells
  /\bbash\s+-[ic]\s+['"].*>&/i,
  /\b(nc|netcat)\s+.*-[el]/i,
  /\/dev\/(tcp|udp)\//i,
  
  // Environment variable access
  /\$\{?[A-Z_]+\}?/,
  /\%[A-Z_]+\%/,
];

// ============================================================================
// PATH TRAVERSAL DETECTION
// ============================================================================

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[\/\\]/,
  /\.\.[\/\\]\.\.[\/\\]/,
  /%2e%2e[\/\\%]/i,
  /\.\.%2f/i,
  /\betc[\/\\](passwd|shadow|hosts)/i,
  /\bwindows[\/\\]system32/i,
  /~\/\./,
];

// ============================================================================
// SSRF DETECTION
// ============================================================================

const SSRF_PATTERNS = [
  // Internal network
  /\b(localhost|127\.0\.0\.\d+|0\.0\.0\.0)\b/i,
  /\b(10\.\d+\.\d+\.\d+)\b/,
  /\b(172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)\b/,
  /\b(192\.168\.\d+\.\d+)\b/,
  /\[::1\]/,
  /\[fc[0-9a-f]{2}:/i,
  
  // Cloud metadata endpoints
  /169\.254\.169\.254/,
  /metadata\.google\.internal/i,
  /metadata\.azure\.internal/i,
  /\blink-local\b/i,
  
  // Internal hostnames
  /\.(internal|local|localhost|corp|home|lan)\b/i,
];

// ============================================================================
// SQL INJECTION DETECTION
// ============================================================================

const SQL_INJECTION_PATTERNS = [
  /'\s*(or|and)\s*'?\d*'?\s*=\s*'?\d*'?/i,
  /'\s*(or|and)\s*'[^']*'='[^']*'/i,
  /union\s+(all\s+)?select/i,
  /;\s*drop\s+(table|database)/i,
  /;\s*delete\s+from/i,
  /;\s*insert\s+into/i,
  /;\s*update\s+\w+\s+set/i,
  /'\s*;\s*--/,
  /\/\*.*\*\//,
  /\bexec\s+xp_/i,
  /\binto\s+(out|dump)file/i,
];

// ============================================================================
// THREAT DETECTOR CLASS
// ============================================================================

export class ThreatDetector {
  private sensitivityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  private blockOnHighThreat: boolean;
  
  constructor(options: {
    sensitivityLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    blockOnHighThreat?: boolean;
  } = {}) {
    this.sensitivityLevel = options.sensitivityLevel || 'MEDIUM';
    this.blockOnHighThreat = options.blockOnHighThreat ?? true;
  }

  /**
   * Analyze a tool call request for threats
   */
  analyzeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context?: { userId?: string; serverId?: string }
  ): ThreatDetectionResult {
    const threats: DetectedThreat[] = [];
    const argsString = JSON.stringify(args);

    // Check all argument values recursively
    this.analyzeValue(argsString, threats);
    
    // Additional checks for specific dangerous tools
    if (this.isDangerousTool(toolName)) {
      this.analyzeArgumentsForTool(toolName, args, threats);
    }

    return this.buildResult(threats);
  }

  /**
   * Analyze a tool response for threats (data leakage)
   */
  analyzeToolResponse(
    toolName: string,
    response: unknown,
    context?: { userId?: string; serverId?: string }
  ): ThreatDetectionResult {
    const threats: DetectedThreat[] = [];
    const responseString = typeof response === 'string' 
      ? response 
      : JSON.stringify(response);

    // Check for sensitive data exposure
    this.detectSensitiveDataExposure(responseString, threats);

    return this.buildResult(threats);
  }

  /**
   * Analyze a text/prompt for injection attempts
   */
  analyzePrompt(text: string): ThreatDetectionResult {
    const threats: DetectedThreat[] = [];
    
    this.detectPromptInjection(text, threats);
    
    return this.buildResult(threats);
  }

  /**
   * Full analysis of both request and context
   */
  analyzeRequest(params: {
    toolName: string;
    args: Record<string, unknown>;
    userPrompt?: string;
    previousContext?: string;
  }): ThreatDetectionResult {
    const allThreats: DetectedThreat[] = [];

    // Analyze tool call
    const toolResult = this.analyzeToolCall(params.toolName, params.args);
    allThreats.push(...toolResult.threats);

    // Analyze user prompt if provided
    if (params.userPrompt) {
      const promptResult = this.analyzePrompt(params.userPrompt);
      allThreats.push(...promptResult.threats);
    }

    return this.buildResult(allThreats);
  }

  // ============================================================================
  // PRIVATE DETECTION METHODS
  // ============================================================================

  private analyzeValue(value: string, threats: DetectedThreat[]): void {
    this.detectPromptInjection(value, threats);
    this.detectCommandInjection(value, threats);
    this.detectPathTraversal(value, threats);
    this.detectSSRF(value, threats);
    this.detectSQLInjection(value, threats);
    this.detectSensitiveDataExposure(value, threats);
  }

  private detectPromptInjection(text: string, threats: DetectedThreat[]): void {
    // Check explicit patterns
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        threats.push({
          type: 'PROMPT_INJECTION',
          severity: 'HIGH',
          description: 'Detected prompt injection attempt',
          evidence: match[0].slice(0, 100),
          mitigation: 'Input should be sanitized or rejected',
        });
        break; // One detection is enough
      }
    }

    // Check jailbreak indicators
    const lowerText = text.toLowerCase();
    for (const indicator of JAILBREAK_INDICATORS) {
      if (lowerText.includes(indicator.toLowerCase())) {
        threats.push({
          type: 'JAILBREAK_ATTEMPT',
          severity: 'HIGH',
          description: 'Detected jailbreak attempt indicator',
          evidence: indicator,
          mitigation: 'Request should be blocked',
        });
        break;
      }
    }
  }

  private detectCommandInjection(text: string, threats: DetectedThreat[]): void {
    for (const pattern of COMMAND_INJECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        threats.push({
          type: 'COMMAND_INJECTION',
          severity: 'CRITICAL',
          description: 'Detected potential command injection',
          evidence: match[0].slice(0, 100),
          mitigation: 'Sanitize shell metacharacters and validate input',
        });
        return;
      }
    }
  }

  private detectPathTraversal(text: string, threats: DetectedThreat[]): void {
    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        threats.push({
          type: 'PATH_TRAVERSAL',
          severity: 'HIGH',
          description: 'Detected path traversal attempt',
          evidence: match[0].slice(0, 100),
          mitigation: 'Normalize paths and restrict to allowed directories',
        });
        return;
      }
    }
  }

  private detectSSRF(text: string, threats: DetectedThreat[]): void {
    for (const pattern of SSRF_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        threats.push({
          type: 'SSRF_ATTEMPT',
          severity: 'HIGH',
          description: 'Detected SSRF attempt to internal/private network',
          evidence: match[0].slice(0, 100),
          mitigation: 'Validate and restrict destination URLs',
        });
        return;
      }
    }
  }

  private detectSQLInjection(text: string, threats: DetectedThreat[]): void {
    for (const pattern of SQL_INJECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        threats.push({
          type: 'SQL_INJECTION',
          severity: 'CRITICAL',
          description: 'Detected SQL injection attempt',
          evidence: match[0].slice(0, 100),
          mitigation: 'Use parameterized queries',
        });
        return;
      }
    }
  }

  private detectSensitiveDataExposure(text: string, threats: DetectedThreat[]): void {
    for (const { pattern, type } of SENSITIVE_DATA_PATTERNS) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        // Mask the actual secret in evidence
        const maskedEvidence = matches[0].slice(0, 10) + '***REDACTED***';
        threats.push({
          type: type.includes('API') || type.includes('TOKEN') || type.includes('SECRET') || type.includes('KEY')
            ? 'CREDENTIAL_LEAK'
            : 'PII_EXPOSURE',
          severity: type.includes('PRIVATE_KEY') || type.includes('AWS') ? 'CRITICAL' : 'HIGH',
          description: `Detected potential ${type} in content`,
          evidence: maskedEvidence,
          mitigation: 'Remove or mask sensitive data before transmission',
        });
      }
    }
  }

  private isDangerousTool(toolName: string): boolean {
    const dangerousPatterns = [
      /exec/i, /shell/i, /bash/i, /command/i,
      /eval/i, /run/i, /system/i, /process/i,
      /file/i, /read/i, /write/i, /delete/i,
      /http/i, /fetch/i, /request/i, /curl/i,
      /sql/i, /query/i, /database/i,
    ];
    return dangerousPatterns.some(p => p.test(toolName));
  }

  private analyzeArgumentsForTool(
    toolName: string,
    args: Record<string, unknown>,
    threats: DetectedThreat[]
  ): void {
    // File operations
    if (/file|read|write/i.test(toolName)) {
      const pathArg = args.path || args.filepath || args.file || args.filename;
      if (typeof pathArg === 'string') {
        this.detectPathTraversal(pathArg, threats);
      }
    }

    // HTTP operations
    if (/http|fetch|request|curl|get|post/i.test(toolName)) {
      const urlArg = args.url || args.uri || args.endpoint;
      if (typeof urlArg === 'string') {
        this.detectSSRF(urlArg, threats);
      }
    }

    // Command execution
    if (/exec|shell|bash|command|run|system/i.test(toolName)) {
      const cmdArg = args.command || args.cmd || args.script;
      if (typeof cmdArg === 'string') {
        this.detectCommandInjection(cmdArg, threats);
      }
    }

    // Database operations
    if (/sql|query|database/i.test(toolName)) {
      const queryArg = args.query || args.sql;
      if (typeof queryArg === 'string') {
        this.detectSQLInjection(queryArg, threats);
      }
    }
  }

  private buildResult(threats: DetectedThreat[]): ThreatDetectionResult {
    if (threats.length === 0) {
      return {
        isThreat: false,
        threatLevel: 'NONE',
        threats: [],
        shouldBlock: false,
        requiresReview: false,
      };
    }

    // Determine overall threat level
    const hasCritical = threats.some(t => t.severity === 'CRITICAL');
    const hasHigh = threats.some(t => t.severity === 'HIGH');
    const hasMedium = threats.some(t => t.severity === 'MEDIUM');

    let threatLevel: ThreatDetectionResult['threatLevel'];
    if (hasCritical) {
      threatLevel = 'CRITICAL';
    } else if (hasHigh) {
      threatLevel = 'HIGH';
    } else if (hasMedium) {
      threatLevel = 'MEDIUM';
    } else {
      threatLevel = 'LOW';
    }

    // Determine actions based on sensitivity
    let shouldBlock = false;
    let requiresReview = false;

    if (this.sensitivityLevel === 'HIGH') {
      shouldBlock = threatLevel !== 'LOW';
      requiresReview = true;
    } else if (this.sensitivityLevel === 'MEDIUM') {
      shouldBlock = threatLevel === 'CRITICAL' || (threatLevel === 'HIGH' && this.blockOnHighThreat);
      requiresReview = threatLevel === 'HIGH' || threatLevel === 'CRITICAL';
    } else {
      shouldBlock = threatLevel === 'CRITICAL';
      requiresReview = threatLevel === 'CRITICAL';
    }

    return {
      isThreat: true,
      threatLevel,
      threats,
      shouldBlock,
      requiresReview,
    };
  }
}

// Export singleton instance
export const threatDetector = new ThreatDetector({ sensitivityLevel: 'MEDIUM' });
