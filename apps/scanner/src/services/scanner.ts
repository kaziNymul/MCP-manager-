import {
  createLogger,
  MCP_JSONRPC,
  SCAN_TIMEOUTS,
  computeRiskAssessment,
  assessToolRisk,
  vulnerabilityScanner,
} from '@mcp-manager/shared';
import type { ToolDefinition, ScanResult, VulnerabilityScanResult } from '@mcp-manager/shared';

const logger = createLogger('scanner');

interface ToolScanResult {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  capabilities: string[];
  riskFlags: string[];
  isDangerous: boolean;
  vulnerabilities?: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    remediation: string;
  }>;
}

/**
 * Scanner Service
 * 
 * Scans MCP servers to:
 * 1. Enumerate available tools via tools/list
 * 2. Analyze tool schemas for dangerous patterns
 * 3. Compute risk scores
 * 4. Generate evidence bundles
 * 
 * IMPORTANT: This is STATIC analysis only.
 * We analyze declared schemas and metadata.
 * We do NOT execute tools or test their behavior dynamically.
 * (Dynamic sandbox testing would be a future enhancement)
 */
export class Scanner {
  private connectTimeout: number;
  private toolsListTimeout: number;

  constructor() {
    this.connectTimeout = SCAN_TIMEOUTS.CONNECT_MS;
    this.toolsListTimeout = SCAN_TIMEOUTS.TOOLS_LIST_MS;
  }

  /**
   * Scan an MCP server endpoint.
   */
  async scanServer(endpoint: string, versionId: string): Promise<ScanResult> {
    logger.info({ endpoint, versionId }, 'Starting server scan');

    try {
      // Step 1: Connect and initialize
      const initResult = await this.sendMcpRequest(endpoint, 'initialize', {
        protocolVersion: MCP_JSONRPC.PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'mcp-manager-scanner',
          version: '0.1.0',
        },
      });

      logger.debug({ initResult }, 'Initialize response');

      // Step 2: List tools
      const toolsResult = await this.sendMcpRequest(endpoint, 'tools/list', {});

      if (!toolsResult || !Array.isArray(toolsResult.tools)) {
        throw new Error('Invalid tools/list response');
      }

      const tools: ToolDefinition[] = toolsResult.tools;
      logger.info({ toolCount: tools.length }, 'Retrieved tool list');

      // Step 3: Run vulnerability scan on endpoint and tools
      const vulnScan = await vulnerabilityScanner.fullScan({
        serverId: versionId,
        serverName: endpoint,
        endpoint,
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

      logger.info({
        vulnCount: vulnScan.vulnerabilities.length,
        securityScore: vulnScan.securityScore,
        riskLevel: vulnScan.riskLevel,
      }, 'Vulnerability scan completed');

      // Step 4: Analyze each tool (combine basic risk + vulnerability analysis)
      const analyzedTools: ToolScanResult[] = tools.map((tool) => {
        const assessment = assessToolRisk(tool);
        const toolVulns = vulnScan.vulnerabilities.filter(v => 
          v.affectedComponent === tool.name || v.affectedComponent?.startsWith(`${tool.name}.`)
        );
        
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          capabilities: assessment.capabilities,
          riskFlags: [
            ...assessment.riskFlags,
            ...toolVulns.map(v => `VULN:${v.type}`),
          ],
          isDangerous: assessment.isDangerous || toolVulns.some(v => 
            v.severity === 'CRITICAL' || v.severity === 'HIGH'
          ),
          vulnerabilities: toolVulns.map(v => ({
            id: v.id,
            type: v.type,
            severity: v.severity,
            title: v.title,
            remediation: v.remediation,
          })),
        };
      });

      // Step 5: Compute overall risk assessment (combine both analyses)
      const baseRiskAssessment = computeRiskAssessment(tools);
      
      // Adjust risk score based on vulnerability scan
      // Lower security score = higher risk score adjustment
      const vulnPenalty = Math.max(0, 100 - vulnScan.securityScore);
      const adjustedScore = Math.min(100, baseRiskAssessment.score + Math.floor(vulnPenalty / 2));
      
      // Combine warnings and flags
      const riskAssessment = {
        ...baseRiskAssessment,
        score: adjustedScore,
        level: vulnScan.riskLevel === 'CRITICAL' ? 'CRITICAL' :
               adjustedScore >= 70 ? 'CRITICAL' :
               adjustedScore >= 50 ? 'HIGH' :
               adjustedScore >= 25 ? 'MEDIUM' : 'LOW',
        warnings: [
          ...baseRiskAssessment.warnings,
          ...vulnScan.recommendations,
        ],
        flags: [
          ...baseRiskAssessment.flags,
          ...vulnScan.vulnerabilities
            .filter(v => v.severity === 'CRITICAL' || v.severity === 'HIGH')
            .map(v => v.id),
        ],
        vulnerabilities: vulnScan.vulnerabilities,
        securityScore: vulnScan.securityScore,
      };

      logger.info(
        {
          riskScore: riskAssessment.score,
          riskLevel: riskAssessment.level,
          dangerousTools: analyzedTools.filter((t) => t.isDangerous).length,
          vulnerabilityCount: vulnScan.vulnerabilities.length,
          securityScore: vulnScan.securityScore,
        },
        'Scan completed'
      );

      return {
        success: true,
        tools: analyzedTools,
        riskAssessment,
        scannedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error({ err, endpoint }, 'Scan failed');

      return {
        success: false,
        tools: [],
        riskAssessment: {
          score: 100,
          level: 'CRITICAL',
          flags: ['scan-failed'],
          warnings: ['Unable to scan server'],
          capabilities: [],
        },
        error: err instanceof Error ? err.message : 'Unknown error',
        scannedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Send an MCP JSON-RPC request.
   */
  private async sendMcpRequest(
    endpoint: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<any> {
    const controller = new AbortController();
    const timeout =
      method === 'initialize' ? this.connectTimeout : this.toolsListTimeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: MCP_JSONRPC.VERSION,
          id: Date.now().toString(),
          method,
          params,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { error?: { message?: string }; result: unknown };

      if (data.error) {
        throw new Error(data.error.message || 'MCP error');
      }

      return data.result;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`);
      }

      throw err;
    }
  }
}
