import {
  DANGEROUS_TOOL_PATTERNS,
  DANGEROUS_CAPABILITY_KEYWORDS,
  WRITE_CAPABILITY_PATTERNS,
  DELETE_CAPABILITY_PATTERNS,
  RISK_THRESHOLDS,
} from '../constants.js';
import type { ToolDefinition } from '../schemas/index.js';

export interface RiskAssessment {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  flags: string[];
  warnings: string[];
  capabilities: string[];
}

export interface ToolRiskAssessment {
  toolName: string;
  isDangerous: boolean;
  capabilities: string[];
  riskFlags: string[];
}

/**
 * Assess risk of a single tool
 */
export function assessToolRisk(tool: ToolDefinition): ToolRiskAssessment {
  const riskFlags: string[] = [];
  const capabilities: string[] = [];
  let isDangerous = false;

  const toolNameLower = tool.name.toLowerCase();
  const descriptionLower = (tool.description || '').toLowerCase();

  // Check for dangerous tool name patterns
  for (const pattern of DANGEROUS_TOOL_PATTERNS) {
    if (pattern.test(tool.name)) {
      isDangerous = true;
      riskFlags.push(`dangerous-name-pattern:${pattern.source}`);
    }
  }

  // Check for dangerous keywords in description
  for (const keyword of DANGEROUS_CAPABILITY_KEYWORDS) {
    if (descriptionLower.includes(keyword.toLowerCase())) {
      isDangerous = true;
      riskFlags.push(`dangerous-capability:${keyword}`);
    }
  }

  // Infer capabilities from name
  for (const pattern of WRITE_CAPABILITY_PATTERNS) {
    if (pattern.test(toolNameLower)) {
      capabilities.push('write');
      break;
    }
  }

  for (const pattern of DELETE_CAPABILITY_PATTERNS) {
    if (pattern.test(toolNameLower)) {
      capabilities.push('delete');
      isDangerous = true;
      riskFlags.push('has-delete-capability');
      break;
    }
  }

  // If no write/delete capabilities found, assume read
  if (capabilities.length === 0) {
    capabilities.push('read');
  }

  // Check for exec-like tools
  if (
    toolNameLower.includes('exec') ||
    toolNameLower.includes('shell') ||
    toolNameLower.includes('command') ||
    toolNameLower.includes('eval')
  ) {
    capabilities.push('exec');
    isDangerous = true;
    riskFlags.push('has-exec-capability');
  }

  // Check for network tools
  if (
    toolNameLower.includes('http') ||
    toolNameLower.includes('fetch') ||
    toolNameLower.includes('request') ||
    toolNameLower.includes('curl')
  ) {
    capabilities.push('network');
    riskFlags.push('has-network-capability');
  }

  // Check for SQL tools
  if (
    toolNameLower.includes('sql') ||
    toolNameLower.includes('query') ||
    toolNameLower.includes('database')
  ) {
    capabilities.push('database');
    if (descriptionLower.includes('arbitrary') || descriptionLower.includes('any')) {
      isDangerous = true;
      riskFlags.push('arbitrary-sql');
    }
  }

  // Check input schema for dangerous patterns
  if (tool.inputSchema?.properties) {
    const props = tool.inputSchema.properties as Record<string, unknown>;
    
    // Check for command/code execution params
    for (const propName of Object.keys(props)) {
      const propLower = propName.toLowerCase();
      if (
        propLower.includes('command') ||
        propLower.includes('script') ||
        propLower.includes('code') ||
        propLower.includes('eval')
      ) {
        riskFlags.push(`dangerous-param:${propName}`);
      }
    }
  }

  return {
    toolName: tool.name,
    isDangerous,
    capabilities: [...new Set(capabilities)],
    riskFlags,
  };
}

/**
 * Compute overall risk assessment for a set of tools
 */
export function computeRiskAssessment(tools: ToolDefinition[]): RiskAssessment {
  const flags: string[] = [];
  const warnings: string[] = [];
  const allCapabilities = new Set<string>();
  
  let dangerousToolCount = 0;
  let writeToolCount = 0;
  let deleteToolCount = 0;
  let execToolCount = 0;

  for (const tool of tools) {
    const assessment = assessToolRisk(tool);
    
    if (assessment.isDangerous) {
      dangerousToolCount++;
      warnings.push(`Tool '${tool.name}' is classified as dangerous`);
    }

    for (const cap of assessment.capabilities) {
      allCapabilities.add(cap);
      if (cap === 'write') writeToolCount++;
      if (cap === 'delete') deleteToolCount++;
      if (cap === 'exec') execToolCount++;
    }

    flags.push(...assessment.riskFlags);
  }

  // Calculate base score
  let score = 0;

  // Each tool adds base points
  score += tools.length * 2;

  // Dangerous tools add significant points
  score += dangerousToolCount * 25;

  // Write tools add moderate points
  score += writeToolCount * 10;

  // Delete tools add more points
  score += deleteToolCount * 20;

  // Exec tools add many points
  score += execToolCount * 30;

  // Cap at 100
  score = Math.min(100, score);

  // Determine risk level
  let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  if (score <= RISK_THRESHOLDS.LOW) {
    level = 'LOW';
  } else if (score <= RISK_THRESHOLDS.MEDIUM) {
    level = 'MEDIUM';
  } else if (score <= RISK_THRESHOLDS.HIGH) {
    level = 'HIGH';
  } else {
    level = 'CRITICAL';
  }

  // Add summary warnings
  if (execToolCount > 0) {
    warnings.push(`${execToolCount} tool(s) with exec capabilities detected`);
  }
  if (deleteToolCount > 0) {
    warnings.push(`${deleteToolCount} tool(s) with delete capabilities detected`);
  }
  if (tools.length > 20) {
    warnings.push(`Large tool surface (${tools.length} tools) increases attack surface`);
    flags.push('large-tool-surface');
  }

  return {
    score,
    level,
    flags: [...new Set(flags)],
    warnings,
    capabilities: [...allCapabilities],
  };
}

/**
 * Check if a version should be auto-approved based on risk score
 */
export function shouldAutoApprove(riskScore: number, threshold: number = 30): boolean {
  return riskScore <= threshold;
}
