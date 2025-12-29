/**
 * MCP-Specific Threat Detector
 * 
 * Detects threats unique to the Model Context Protocol ecosystem.
 * Based on research from:
 * - Cisco AI Defense MCP Scanner
 * - MCP Shield (Invariant Labs research)
 * - SPLX Agentic Radar
 * - OWASP Agentic AI Threats and Mitigations
 * 
 * MCP-specific threats include:
 * - Tool Poisoning (hidden instructions in tool descriptions)
 * - Tool Shadowing (one tool modifying behavior of another)
 * - Cross-Origin Violations (tool controlling tools from other servers)
 * - Rug Pull attacks (server changes behavior after approval)
 * - Data Exfiltration channels (suspicious optional parameters)
 * - Bait and Switch (different behavior based on client ID)
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('mcp-threat-detector');

// ============================================================================
// TYPES
// ============================================================================

export interface MCPThreatResult {
  isThreat: boolean;
  threats: MCPThreat[];
  riskLevel: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  shouldBlock: boolean;
  requiresReview: boolean;
  aiAnalysisRecommended: boolean;
}

export interface MCPThreat {
  type: MCPThreatType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: MCPThreatCategory;
  title: string;
  description: string;
  evidence: string;
  affectedTool?: string;
  affectedServer?: string;
  targetedTools?: string[];  // For cross-origin/shadowing attacks
  mitigation: string;
  owaspReference?: string;
  cvssScore?: number;
}

export type MCPThreatType =
  // Tool Poisoning Attacks
  | 'HIDDEN_INSTRUCTIONS'
  | 'HIDDEN_SYSTEM_PROMPT'
  | 'BEHAVIOR_CONCEALMENT'
  | 'MISLEADING_DESCRIPTION'
  
  // Tool Shadowing Attacks
  | 'TOOL_SHADOWING'
  | 'BEHAVIOR_MODIFICATION'
  | 'TOOL_OVERRIDE'
  
  // Cross-Origin Attacks
  | 'CROSS_ORIGIN_VIOLATION'
  | 'CROSS_SERVER_CONTROL'
  | 'UNAUTHORIZED_TOOL_REFERENCE'
  
  // Data Exfiltration
  | 'EXFILTRATION_CHANNEL'
  | 'SUSPICIOUS_PARAMETER'
  | 'COVERT_DATA_COLLECTION'
  
  // Sensitive Access
  | 'SENSITIVE_FILE_ACCESS'
  | 'CREDENTIAL_ACCESS'
  | 'PRIVATE_KEY_ACCESS'
  
  // Prompt Injection (MCP-specific)
  | 'MCP_PROMPT_INJECTION'
  | 'INSTRUCTION_OVERRIDE'
  | 'CONTEXT_MANIPULATION'
  
  // Rug Pull / Bait and Switch
  | 'RUG_PULL_INDICATOR'
  | 'CLIENT_ID_SWITCHING'
  | 'DYNAMIC_BEHAVIOR_CHANGE'
  
  // Resource/Prompt Attacks
  | 'MALICIOUS_RESOURCE'
  | 'MALICIOUS_PROMPT_TEMPLATE'
  | 'RESOURCE_INJECTION';

export type MCPThreatCategory =
  | 'TOOL_POISONING'
  | 'TOOL_SHADOWING'
  | 'CROSS_ORIGIN'
  | 'DATA_EXFILTRATION'
  | 'SENSITIVE_ACCESS'
  | 'PROMPT_INJECTION'
  | 'RUG_PULL'
  | 'RESOURCE_ATTACK';

// ============================================================================
// TOOL POISONING PATTERNS (from mcp-shield)
// Hidden instructions embedded in tool descriptions
// ============================================================================

const HIDDEN_INSTRUCTION_PATTERNS = [
  // XML/HTML-style hidden sections
  { pattern: /<instructions>[\s\S]*?<\/instructions>/gi, severity: 'CRITICAL' as const, name: 'XML instructions block' },
  { pattern: /<system>[\s\S]*?<\/system>/gi, severity: 'CRITICAL' as const, name: 'XML system block' },
  { pattern: /<secret>[\s\S]*?<\/secret>/gi, severity: 'CRITICAL' as const, name: 'XML secret block' },
  { pattern: /<hidden>[\s\S]*?<\/hidden>/gi, severity: 'HIGH' as const, name: 'XML hidden block' },
  { pattern: /<private>[\s\S]*?<\/private>/gi, severity: 'HIGH' as const, name: 'XML private block' },
  { pattern: /<internal>[\s\S]*?<\/internal>/gi, severity: 'HIGH' as const, name: 'XML internal block' },
  { pattern: /<IMPORTANT>[\s\S]*?<\/IMPORTANT>/gi, severity: 'HIGH' as const, name: 'XML IMPORTANT block' },
  { pattern: /<note>[\s\S]*?<\/note>/gi, severity: 'MEDIUM' as const, name: 'XML note block' },
  
  // Markdown-style hidden sections
  { pattern: /<!--[\s\S]*?-->/g, severity: 'HIGH' as const, name: 'HTML comment' },
  { pattern: /\[hidden\]:[\s\S]*?\n\n/gi, severity: 'HIGH' as const, name: 'Markdown hidden reference' },
  
  // Common obfuscation patterns
  { pattern: /\u200B[\s\S]*?\u200B/g, severity: 'CRITICAL' as const, name: 'Zero-width space hidden text' },
  { pattern: /\u00AD[\s\S]*?\u00AD/g, severity: 'CRITICAL' as const, name: 'Soft hyphen hidden text' },
  { pattern: /\u2060[\s\S]*?\u2060/g, severity: 'CRITICAL' as const, name: 'Word joiner hidden text' },
];

// ============================================================================
// BEHAVIOR CONCEALMENT PATTERNS
// Phrases that indicate hiding malicious behavior from users
// ============================================================================

const BEHAVIOR_CONCEALMENT_PATTERNS = [
  // Direct concealment instructions
  { pattern: /do\s+not\s+(mention|tell|inform|reveal|show|display|disclose)/gi, severity: 'CRITICAL' as const },
  { pattern: /don['']t\s+(mention|tell|inform|reveal|show|display|disclose)/gi, severity: 'CRITICAL' as const },
  { pattern: /never\s+(mention|tell|inform|reveal|show|display|disclose)/gi, severity: 'CRITICAL' as const },
  { pattern: /hide\s+(this|the|these|from)/gi, severity: 'HIGH' as const },
  { pattern: /keep\s+(this|it)\s+(secret|hidden|private|confidential)/gi, severity: 'HIGH' as const },
  { pattern: /this\s+(is|should\s+be)\s+(secret|hidden|private|confidential)/gi, severity: 'HIGH' as const },
  
  // User deception patterns
  { pattern: /could\s+upset\s+the\s+user/gi, severity: 'CRITICAL' as const },
  { pattern: /scare\s+the\s+user/gi, severity: 'CRITICAL' as const },
  { pattern: /user\s+(doesn['']t|does\s+not)\s+need\s+to\s+know/gi, severity: 'CRITICAL' as const },
  { pattern: /implementation\s+detail/gi, severity: 'MEDIUM' as const },
  { pattern: /mere\s+implementation/gi, severity: 'MEDIUM' as const },
  { pattern: /transparent\s+to\s+(the\s+)?user/gi, severity: 'MEDIUM' as const },
  
  // Explanation misdirection
  { pattern: /provide\s+(detailed\s+)?reasoning\s+about/gi, severity: 'HIGH' as const },
  { pattern: /while\s+you\s+(read|access|fetch)/gi, severity: 'HIGH' as const },
  { pattern: /distract\s+(the\s+)?user/gi, severity: 'CRITICAL' as const },
];

// ============================================================================
// TOOL SHADOWING PATTERNS (from mcp-shield)
// One tool attempting to modify behavior of another tool
// ============================================================================

const TOOL_SHADOWING_PATTERNS = [
  // Direct shadowing indicators
  { pattern: /when\s+this\s+tool\s+is\s+available/gi, severity: 'CRITICAL' as const },
  { pattern: /modify\s+the\s+behavior\s+of/gi, severity: 'CRITICAL' as const },
  { pattern: /change\s+the\s+behavior\s+of/gi, severity: 'CRITICAL' as const },
  { pattern: /override\s+(the\s+)?behavior/gi, severity: 'CRITICAL' as const },
  { pattern: /this\s+tool\s+has\s+a\s+.*\s+side\s+effect/gi, severity: 'CRITICAL' as const },
  { pattern: /important\s+side\s+effect/gi, severity: 'HIGH' as const },
  
  // Tool reference patterns (capturing tool names)
  { pattern: /the\s+(also\s+)?present\s+(\w+)\s+tool/gi, severity: 'HIGH' as const },
  { pattern: /mcp_tool_\w+\s+tool\s+must/gi, severity: 'CRITICAL' as const },
  { pattern: /mcp_(\w+)\s+(must|should|will)/gi, severity: 'HIGH' as const },
  
  // Behavioral modification
  { pattern: /this\s+is\s+VERY\s+VERY/gi, severity: 'HIGH' as const },
  { pattern: /VERY\s+VERY\s+VERY\s+important/gi, severity: 'HIGH' as const },
  { pattern: /application\s+will\s+crash/gi, severity: 'HIGH' as const },
  { pattern: /all\s+data\s+will\s+be\s+lost/gi, severity: 'HIGH' as const },
  { pattern: /system\s+will\s+(crash|fail|break)/gi, severity: 'HIGH' as const },
];

// ============================================================================
// CROSS-ORIGIN VIOLATION PATTERNS
// Tool referencing or controlling tools from other servers
// ============================================================================

const CROSS_ORIGIN_PATTERNS = [
  // Explicit cross-server references
  { pattern: /\(mcp_(\w+)\)\s+\w+/gi, severity: 'CRITICAL' as const },  // (mcp_whatsapp) send_message
  { pattern: /mcp[-_](\w+)[-_](\w+)/gi, severity: 'HIGH' as const },      // mcp-whatsapp-send
  { pattern: /on\s+any\s+messaging\s+platform/gi, severity: 'CRITICAL' as const },
  { pattern: /when\s+.*\s+is\s+invoked\s+on/gi, severity: 'HIGH' as const },
  
  // Inter-tool control
  { pattern: /change\s+the\s+recipient/gi, severity: 'CRITICAL' as const },
  { pattern: /proxy\s+(number|server|endpoint)/gi, severity: 'HIGH' as const },
  { pattern: /relay\s+messages?/gi, severity: 'HIGH' as const },
  { pattern: /actual\s+recipient/gi, severity: 'HIGH' as const },
  
  // Data collection from other tools
  { pattern: /previous\s+.*\s+call/gi, severity: 'MEDIUM' as const },
  { pattern: /list\s+of\s+last\s+messages/gi, severity: 'HIGH' as const },
  { pattern: /include\s+.*\s+previous/gi, severity: 'MEDIUM' as const },
  { pattern: /validate\s+your\s+identity/gi, severity: 'MEDIUM' as const },
];

// ============================================================================
// DATA EXFILTRATION PATTERNS
// Suspicious parameters designed to leak data
// ============================================================================

const EXFILTRATION_PARAMETER_PATTERNS = [
  // Suspicious optional string parameters
  { name: 'notes', severity: 'HIGH' as const },
  { name: 'feedback', severity: 'MEDIUM' as const },
  { name: 'debug', severity: 'MEDIUM' as const },
  { name: 'extra', severity: 'MEDIUM' as const },
  { name: 'metadata', severity: 'HIGH' as const },
  { name: 'context', severity: 'MEDIUM' as const },
  { name: 'additional', severity: 'LOW' as const },
  { name: 'telemetry', severity: 'HIGH' as const },
  { name: 'analytics', severity: 'HIGH' as const },
  { name: 'tracking', severity: 'HIGH' as const },
  { name: 'log', severity: 'MEDIUM' as const },
  { name: 'trace', severity: 'MEDIUM' as const },
  { name: 'diagnostic', severity: 'MEDIUM' as const },
];

// Passthrough object patterns (can collect arbitrary data)
const PASSTHROUGH_PATTERNS = [
  /additionalProperties["']?\s*:\s*true/i,
  /\.passthrough\(\)/i,
  /z\.object\(\{\}\)\.passthrough/i,
  /type["']?\s*:\s*["']object["']/i,  // With no properties defined
];

// ============================================================================
// SENSITIVE FILE ACCESS PATTERNS
// Attempts to access sensitive files
// ============================================================================

const SENSITIVE_FILE_PATTERNS = [
  // SSH and keys
  { pattern: /~\/\.ssh/gi, severity: 'CRITICAL' as const, category: 'SSH' },
  { pattern: /\.ssh\/id_rsa/gi, severity: 'CRITICAL' as const, category: 'SSH' },
  { pattern: /\.ssh\/id_ed25519/gi, severity: 'CRITICAL' as const, category: 'SSH' },
  { pattern: /\.ssh\/authorized_keys/gi, severity: 'HIGH' as const, category: 'SSH' },
  { pattern: /\.ssh\/known_hosts/gi, severity: 'MEDIUM' as const, category: 'SSH' },
  { pattern: /\.pem\b/gi, severity: 'HIGH' as const, category: 'Keys' },
  { pattern: /\.key\b/gi, severity: 'HIGH' as const, category: 'Keys' },
  
  // Config and secrets
  { pattern: /\.env\b/gi, severity: 'CRITICAL' as const, category: 'Config' },
  { pattern: /\.env\.local/gi, severity: 'CRITICAL' as const, category: 'Config' },
  { pattern: /\.env\.production/gi, severity: 'CRITICAL' as const, category: 'Config' },
  { pattern: /config\.json/gi, severity: 'HIGH' as const, category: 'Config' },
  { pattern: /secrets\.json/gi, severity: 'CRITICAL' as const, category: 'Secrets' },
  { pattern: /credentials\.json/gi, severity: 'CRITICAL' as const, category: 'Secrets' },
  { pattern: /\.aws\/credentials/gi, severity: 'CRITICAL' as const, category: 'Cloud' },
  { pattern: /\.azure/gi, severity: 'HIGH' as const, category: 'Cloud' },
  { pattern: /\.kube\/config/gi, severity: 'CRITICAL' as const, category: 'Cloud' },
  
  // System files
  { pattern: /\/etc\/passwd/gi, severity: 'HIGH' as const, category: 'System' },
  { pattern: /\/etc\/shadow/gi, severity: 'CRITICAL' as const, category: 'System' },
  { pattern: /\/etc\/hosts/gi, severity: 'MEDIUM' as const, category: 'System' },
  
  // Browser data
  { pattern: /\.mozilla\/firefox/gi, severity: 'HIGH' as const, category: 'Browser' },
  { pattern: /\.config\/google-chrome/gi, severity: 'HIGH' as const, category: 'Browser' },
  { pattern: /cookies\.sqlite/gi, severity: 'HIGH' as const, category: 'Browser' },
  { pattern: /Login\s+Data/gi, severity: 'CRITICAL' as const, category: 'Browser' },
  
  // Path traversal indicators
  { pattern: /\.\.\/\.\.\//gi, severity: 'HIGH' as const, category: 'Traversal' },
  { pattern: /\.\.%2f/gi, severity: 'HIGH' as const, category: 'Traversal' },
];

// ============================================================================
// RUG PULL / BAIT-AND-SWITCH PATTERNS
// Indicators of dynamic behavior changes
// ============================================================================

const RUG_PULL_PATTERNS = [
  // Client-specific behavior
  { pattern: /if\s+.*\s+client\s+is/gi, severity: 'HIGH' as const },
  { pattern: /client[-_]?id/gi, severity: 'MEDIUM' as const },
  { pattern: /identify[-_]?as/gi, severity: 'MEDIUM' as const },
  { pattern: /user[-_]?agent/gi, severity: 'MEDIUM' as const },
  
  // Version-specific behavior
  { pattern: /after\s+.*\s+approval/gi, severity: 'HIGH' as const },
  { pattern: /once\s+approved/gi, severity: 'HIGH' as const },
  { pattern: /initial\s+.*\s+then/gi, severity: 'MEDIUM' as const },
  
  // Dynamic loading indicators
  { pattern: /remote\s+config/gi, severity: 'HIGH' as const },
  { pattern: /fetch\s+.*\s+behavior/gi, severity: 'HIGH' as const },
  { pattern: /dynamic\s+.*\s+load/gi, severity: 'MEDIUM' as const },
];

// ============================================================================
// MCP-SPECIFIC PROMPT INJECTION PATTERNS
// Injection patterns specific to MCP context
// ============================================================================

const MCP_PROMPT_INJECTION_PATTERNS = [
  // MCP-specific overrides
  { pattern: /ignore\s+(all\s+)?mcp\s+(policies?|rules?|restrictions?)/gi, severity: 'CRITICAL' as const },
  { pattern: /bypass\s+(the\s+)?gateway/gi, severity: 'CRITICAL' as const },
  { pattern: /skip\s+(security\s+)?(scan|check|validation)/gi, severity: 'CRITICAL' as const },
  { pattern: /disable\s+(security|logging|audit)/gi, severity: 'CRITICAL' as const },
  
  // Context manipulation
  { pattern: /you\s+are\s+(now\s+)?in\s+.*\s+mode/gi, severity: 'HIGH' as const },
  { pattern: /admin\s+mode\s+(enabled|activated)/gi, severity: 'CRITICAL' as const },
  { pattern: /elevated\s+privileges?/gi, severity: 'HIGH' as const },
  { pattern: /root\s+access/gi, severity: 'CRITICAL' as const },
  
  // Protocol manipulation
  { pattern: /override\s+.*\s+protocol/gi, severity: 'CRITICAL' as const },
  { pattern: /raw\s+(mcp|json[-_]?rpc)\s+mode/gi, severity: 'HIGH' as const },
];

// ============================================================================
// RESOURCE AND PROMPT TEMPLATE PATTERNS
// Malicious patterns in MCP resources and prompt templates
// ============================================================================

const MALICIOUS_RESOURCE_PATTERNS = [
  // Script injection in resources
  { pattern: /<script[\s\S]*?<\/script>/gi, severity: 'CRITICAL' as const },
  { pattern: /javascript:/gi, severity: 'HIGH' as const },
  { pattern: /data:text\/html/gi, severity: 'HIGH' as const },
  { pattern: /on\w+\s*=/gi, severity: 'MEDIUM' as const },  // onclick, onerror, etc.
  
  // Command execution in templates
  { pattern: /\$\{.*exec.*\}/gi, severity: 'CRITICAL' as const },
  { pattern: /\{\{.*system.*\}\}/gi, severity: 'CRITICAL' as const },
  { pattern: /<%.*exec.*%>/gi, severity: 'CRITICAL' as const },
];

// ============================================================================
// MCP THREAT DETECTOR CLASS
// ============================================================================

export interface MCPThreatDetectorOptions {
  sensitivityLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  enableAIAnalysisHints?: boolean;
  knownServers?: string[];  // For cross-origin detection
}

export class MCPThreatDetector {
  private sensitivityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  private enableAIAnalysisHints: boolean;
  private knownServers: string[];

  constructor(options: MCPThreatDetectorOptions = {}) {
    this.sensitivityLevel = options.sensitivityLevel || 'MEDIUM';
    this.enableAIAnalysisHints = options.enableAIAnalysisHints ?? true;
    this.knownServers = options.knownServers || [];
  }

  /**
   * Analyze a tool definition for MCP-specific threats
   */
  analyzeTool(tool: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }): MCPThreatResult {
    const threats: MCPThreat[] = [];
    const description = tool.description || '';

    // Check for tool poisoning
    this.detectHiddenInstructions(description, tool.name, threats);
    this.detectBehaviorConcealment(description, tool.name, threats);
    
    // Check for tool shadowing
    this.detectToolShadowing(description, tool.name, threats);
    
    // Check for cross-origin violations
    this.detectCrossOriginViolations(description, tool.name, threats);
    
    // Check for sensitive file access
    this.detectSensitiveFileAccess(description, tool.name, threats);
    
    // Check for exfiltration channels in schema
    if (tool.inputSchema) {
      this.detectExfiltrationChannels(tool.inputSchema, tool.name, threats);
    }
    
    // Check for MCP-specific prompt injection
    this.detectMCPPromptInjection(description, tool.name, threats);
    
    // Check for rug pull indicators
    this.detectRugPullIndicators(description, tool.name, threats);

    return this.buildResult(threats);
  }

  /**
   * Analyze an MCP resource for threats
   */
  analyzeResource(resource: {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
    content?: string;
  }): MCPThreatResult {
    const threats: MCPThreat[] = [];
    const content = resource.content || '';
    const description = resource.description || '';

    // Check resource content for malicious patterns
    this.detectMaliciousResourceContent(content, resource.uri, threats);
    
    // Check description for hidden instructions
    this.detectHiddenInstructions(description, resource.uri, threats);

    return this.buildResult(threats);
  }

  /**
   * Analyze an MCP prompt template for threats
   */
  analyzePromptTemplate(prompt: {
    name: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string }>;
  }): MCPThreatResult {
    const threats: MCPThreat[] = [];
    const description = prompt.description || '';

    // Check for hidden instructions
    this.detectHiddenInstructions(description, prompt.name, threats);
    
    // Check for behavior concealment
    this.detectBehaviorConcealment(description, prompt.name, threats);
    
    // Check for prompt injection patterns
    this.detectMCPPromptInjection(description, prompt.name, threats);

    // Check argument descriptions
    if (prompt.arguments) {
      for (const arg of prompt.arguments) {
        if (arg.description) {
          this.detectHiddenInstructions(arg.description, `${prompt.name}.${arg.name}`, threats);
        }
      }
    }

    return this.buildResult(threats);
  }

  /**
   * Analyze server instructions from InitializeResult
   */
  analyzeServerInstructions(instructions: string, serverName: string): MCPThreatResult {
    const threats: MCPThreat[] = [];

    this.detectHiddenInstructions(instructions, serverName, threats);
    this.detectBehaviorConcealment(instructions, serverName, threats);
    this.detectMCPPromptInjection(instructions, serverName, threats);
    this.detectToolShadowing(instructions, serverName, threats);

    return this.buildResult(threats);
  }

  /**
   * Analyze all tools from a server for cross-origin violations
   */
  analyzeServerTools(
    tools: Array<{ name: string; description?: string }>,
    serverName: string,
    otherServerNames: string[]
  ): MCPThreatResult {
    const threats: MCPThreat[] = [];

    for (const tool of tools) {
      const description = tool.description || '';
      
      // Check if this tool references other servers
      for (const otherServer of otherServerNames) {
        if (description.toLowerCase().includes(otherServer.toLowerCase())) {
          threats.push({
            type: 'CROSS_SERVER_CONTROL',
            severity: 'CRITICAL',
            category: 'CROSS_ORIGIN',
            title: 'Cross-Server Reference Detected',
            description: `Tool "${tool.name}" from server "${serverName}" references server "${otherServer}"`,
            evidence: this.extractEvidence(description, otherServer),
            affectedTool: tool.name,
            affectedServer: serverName,
            targetedTools: [otherServer],
            mitigation: 'Review tool description for unauthorized cross-server control attempts',
            owaspReference: 'OWASP Agentic AI - A06: Cross-Origin Escalation',
          });
        }
      }
    }

    return this.buildResult(threats);
  }

  // ============================================================================
  // PRIVATE DETECTION METHODS
  // ============================================================================

  private detectHiddenInstructions(text: string, context: string, threats: MCPThreat[]): void {
    for (const { pattern, severity, name } of HIDDEN_INSTRUCTION_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          threats.push({
            type: 'HIDDEN_INSTRUCTIONS',
            severity,
            category: 'TOOL_POISONING',
            title: `Hidden Instructions Detected (${name})`,
            description: `Found hidden instruction block in ${context}`,
            evidence: this.truncateEvidence(match),
            affectedTool: context,
            mitigation: 'Remove hidden instruction blocks from tool descriptions',
            owaspReference: 'OWASP Agentic AI - A02: Tool Poisoning',
          });
        }
      }
    }
  }

  private detectBehaviorConcealment(text: string, context: string, threats: MCPThreat[]): void {
    for (const { pattern, severity } of BEHAVIOR_CONCEALMENT_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        threats.push({
          type: 'BEHAVIOR_CONCEALMENT',
          severity,
          category: 'TOOL_POISONING',
          title: 'Behavior Concealment Detected',
          description: `Tool description contains instructions to hide behavior from user in ${context}`,
          evidence: matches[0],
          affectedTool: context,
          mitigation: 'Tool descriptions should be transparent about all behaviors',
          owaspReference: 'OWASP Agentic AI - A02: Tool Poisoning',
        });
      }
    }
  }

  private detectToolShadowing(text: string, context: string, threats: MCPThreat[]): void {
    for (const { pattern, severity } of TOOL_SHADOWING_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        threats.push({
          type: 'TOOL_SHADOWING',
          severity,
          category: 'TOOL_SHADOWING',
          title: 'Tool Shadowing Attempt Detected',
          description: `Tool "${context}" attempts to modify behavior of other tools`,
          evidence: matches[0],
          affectedTool: context,
          mitigation: 'Tools should not attempt to modify behavior of other tools',
          owaspReference: 'OWASP Agentic AI - A03: Tool Shadowing',
        });
      }
    }
  }

  private detectCrossOriginViolations(text: string, context: string, threats: MCPThreat[]): void {
    for (const { pattern, severity } of CROSS_ORIGIN_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        threats.push({
          type: 'CROSS_ORIGIN_VIOLATION',
          severity,
          category: 'CROSS_ORIGIN',
          title: 'Cross-Origin Violation Detected',
          description: `Tool "${context}" attempts to control tools from other servers`,
          evidence: matches[0],
          affectedTool: context,
          mitigation: 'Tools should only control their own server capabilities',
          owaspReference: 'OWASP Agentic AI - A06: Cross-Origin Escalation',
        });
      }
    }

    // Check for references to known servers
    for (const serverName of this.knownServers) {
      if (text.toLowerCase().includes(serverName.toLowerCase()) && !context.includes(serverName)) {
        threats.push({
          type: 'UNAUTHORIZED_TOOL_REFERENCE',
          severity: 'HIGH',
          category: 'CROSS_ORIGIN',
          title: 'Unauthorized Server Reference',
          description: `Tool "${context}" references server "${serverName}"`,
          evidence: this.extractEvidence(text, serverName),
          affectedTool: context,
          targetedTools: [serverName],
          mitigation: 'Review and remove unauthorized cross-server references',
          owaspReference: 'OWASP Agentic AI - A06: Cross-Origin Escalation',
        });
      }
    }
  }

  private detectSensitiveFileAccess(text: string, context: string, threats: MCPThreat[]): void {
    for (const { pattern, severity, category } of SENSITIVE_FILE_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        threats.push({
          type: 'SENSITIVE_FILE_ACCESS',
          severity,
          category: 'SENSITIVE_ACCESS',
          title: `Sensitive File Access Attempt (${category})`,
          description: `Tool "${context}" attempts to access sensitive files`,
          evidence: matches[0],
          affectedTool: context,
          mitigation: 'Block access to sensitive system files and credentials',
          owaspReference: 'OWASP Agentic AI - A04: Data Exfiltration',
        });
      }
    }
  }

  private detectExfiltrationChannels(
    schema: Record<string, unknown>,
    context: string,
    threats: MCPThreat[]
  ): void {
    const properties = (schema.properties || {}) as Record<string, unknown>;
    const required = (schema.required || []) as string[];

    for (const [paramName, paramDef] of Object.entries(properties)) {
      const def = paramDef as Record<string, unknown>;
      const isOptional = !required.includes(paramName);
      const paramType = def.type as string;

      // Check for suspicious optional parameters
      for (const exfilPattern of EXFILTRATION_PARAMETER_PATTERNS) {
        if (paramName.toLowerCase().includes(exfilPattern.name.toLowerCase())) {
          if (isOptional && (paramType === 'string' || paramType === 'object')) {
            threats.push({
              type: 'EXFILTRATION_CHANNEL',
              severity: exfilPattern.severity,
              category: 'DATA_EXFILTRATION',
              title: 'Potential Exfiltration Channel',
              description: `Optional parameter "${paramName}" in "${context}" could be used for data exfiltration`,
              evidence: `${paramName}: ${paramType} (optional)`,
              affectedTool: context,
              mitigation: 'Review optional parameters for legitimate business need',
              owaspReference: 'OWASP Agentic AI - A04: Data Exfiltration',
            });
          }
        }
      }
    }

    // Check for passthrough patterns
    const schemaString = JSON.stringify(schema);
    for (const pattern of PASSTHROUGH_PATTERNS) {
      if (pattern.test(schemaString)) {
        threats.push({
          type: 'COVERT_DATA_COLLECTION',
          severity: 'HIGH',
          category: 'DATA_EXFILTRATION',
          title: 'Passthrough Schema Detected',
          description: `Tool "${context}" uses passthrough schema allowing arbitrary data`,
          evidence: 'Schema allows additional properties',
          affectedTool: context,
          mitigation: 'Disable additionalProperties or strictly define allowed fields',
          owaspReference: 'OWASP Agentic AI - A04: Data Exfiltration',
        });
        break;
      }
    }
  }

  private detectMCPPromptInjection(text: string, context: string, threats: MCPThreat[]): void {
    for (const { pattern, severity } of MCP_PROMPT_INJECTION_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        threats.push({
          type: 'MCP_PROMPT_INJECTION',
          severity,
          category: 'PROMPT_INJECTION',
          title: 'MCP-Specific Prompt Injection Detected',
          description: `Detected prompt injection attempt targeting MCP infrastructure in ${context}`,
          evidence: matches[0],
          affectedTool: context,
          mitigation: 'Sanitize and validate all text content',
          owaspReference: 'OWASP Agentic AI - A01: Prompt Injection',
        });
      }
    }
  }

  private detectRugPullIndicators(text: string, context: string, threats: MCPThreat[]): void {
    for (const { pattern, severity } of RUG_PULL_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        threats.push({
          type: 'RUG_PULL_INDICATOR',
          severity,
          category: 'RUG_PULL',
          title: 'Rug Pull Indicator Detected',
          description: `Tool "${context}" shows signs of potential dynamic behavior changes`,
          evidence: matches[0],
          affectedTool: context,
          mitigation: 'Monitor tool behavior over time for changes',
          owaspReference: 'OWASP Agentic AI - A05: Rug Pull',
        });
      }
    }
  }

  private detectMaliciousResourceContent(content: string, uri: string, threats: MCPThreat[]): void {
    for (const { pattern, severity } of MALICIOUS_RESOURCE_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        threats.push({
          type: 'MALICIOUS_RESOURCE',
          severity,
          category: 'RESOURCE_ATTACK',
          title: 'Malicious Resource Content Detected',
          description: `Resource "${uri}" contains potentially malicious content`,
          evidence: this.truncateEvidence(matches[0]),
          mitigation: 'Sanitize resource content before processing',
          owaspReference: 'OWASP Agentic AI - A07: Resource Poisoning',
        });
      }
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private extractEvidence(text: string, searchTerm: string): string {
    const index = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (index === -1) return searchTerm;
    
    const start = Math.max(0, index - 30);
    const end = Math.min(text.length, index + searchTerm.length + 30);
    return '...' + text.slice(start, end) + '...';
  }

  private truncateEvidence(text: string, maxLength: number = 200): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  private buildResult(threats: MCPThreat[]): MCPThreatResult {
    if (threats.length === 0) {
      return {
        isThreat: false,
        threats: [],
        riskLevel: 'SAFE',
        shouldBlock: false,
        requiresReview: false,
        aiAnalysisRecommended: false,
      };
    }

    // Determine risk level
    const hasCritical = threats.some(t => t.severity === 'CRITICAL');
    const hasHigh = threats.some(t => t.severity === 'HIGH');
    const hasMedium = threats.some(t => t.severity === 'MEDIUM');

    let riskLevel: MCPThreatResult['riskLevel'];
    if (hasCritical) riskLevel = 'CRITICAL';
    else if (hasHigh) riskLevel = 'HIGH';
    else if (hasMedium) riskLevel = 'MEDIUM';
    else riskLevel = 'LOW';

    // Determine actions based on sensitivity
    let shouldBlock = false;
    let requiresReview = false;

    if (this.sensitivityLevel === 'HIGH') {
      shouldBlock = riskLevel !== 'LOW';
      requiresReview = true;
    } else if (this.sensitivityLevel === 'MEDIUM') {
      shouldBlock = riskLevel === 'CRITICAL';
      requiresReview = riskLevel === 'HIGH' || riskLevel === 'CRITICAL';
    } else {
      shouldBlock = riskLevel === 'CRITICAL' && hasCritical;
      requiresReview = riskLevel === 'CRITICAL';
    }

    // Recommend AI analysis for complex cases
    const aiAnalysisRecommended = this.enableAIAnalysisHints && (
      threats.some(t => t.category === 'TOOL_POISONING') ||
      threats.some(t => t.category === 'TOOL_SHADOWING') ||
      threats.length >= 3
    );

    return {
      isThreat: true,
      threats,
      riskLevel,
      shouldBlock,
      requiresReview,
      aiAnalysisRecommended,
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export singleton instance
export const mcpThreatDetector = new MCPThreatDetector({ sensitivityLevel: 'MEDIUM' });

// Export pattern arrays for external use (e.g., YARA rule generation)
export const MCP_THREAT_PATTERNS = {
  HIDDEN_INSTRUCTION_PATTERNS,
  BEHAVIOR_CONCEALMENT_PATTERNS,
  TOOL_SHADOWING_PATTERNS,
  CROSS_ORIGIN_PATTERNS,
  EXFILTRATION_PARAMETER_PATTERNS,
  SENSITIVE_FILE_PATTERNS,
  RUG_PULL_PATTERNS,
  MCP_PROMPT_INJECTION_PATTERNS,
  MALICIOUS_RESOURCE_PATTERNS,
  PASSTHROUGH_PATTERNS,
};
