import { prisma } from '@mcp-manager/prisma';
import type { UserContext, PolicyEvaluationResult, ToolCallContext } from '@mcp-manager/shared';

/**
 * Policy Engine
 * 
 * Evaluates policies for tool calls at runtime.
 * 
 * Policy evaluation order:
 * 1. Global deny lists (highest priority)
 * 2. Capability gates
 * 3. Team-specific policies
 * 4. Global allow lists
 * 
 * Deny takes precedence over allow.
 */
export class PolicyEngine {
  /**
   * Evaluate whether a tool call is allowed.
   */
  async evaluateToolCall(context: ToolCallContext): Promise<PolicyEvaluationResult> {
    const { serverName, toolName, arguments: args, user } = context;

    // Get all applicable policies for the user's org
    const policies = await prisma.policy.findMany({
      where: {
        orgId: user.orgId,
        isEnabled: true,
        OR: [
          { teamId: null }, // Global policies
          { teamId: { in: user.teams.map((t) => t.teamId) } }, // Team policies
        ],
      },
      orderBy: { priority: 'desc' },
    });

    // Evaluate each policy in priority order
    for (const policy of policies) {
      const result = await this.evaluatePolicy(policy, context);
      if (!result.allowed) {
        return result;
      }
      if (result.requiresApproval) {
        // For MVP, we just block if approval required
        return {
          allowed: false,
          reason: result.reason || 'This action requires approval',
          policyName: policy.name,
          policyType: policy.type,
          requiresApproval: true,
        };
      }
    }

    // Check team access
    const hasTeamAccess = await this.checkTeamAccess(serverName, toolName, user);
    if (!hasTeamAccess.allowed) {
      return hasTeamAccess;
    }

    return { allowed: true };
  }

  /**
   * Evaluate a single policy against the tool call context.
   */
  private async evaluatePolicy(
    policy: any,
    context: ToolCallContext
  ): Promise<PolicyEvaluationResult> {
    const { serverName, toolName, arguments: args } = context;
    const rules = policy.rules as Record<string, any>;

    switch (policy.type) {
      case 'TOOL_DENYLIST':
        return this.evaluateDenylist(policy, rules, toolName);

      case 'TOOL_ALLOWLIST':
        return this.evaluateAllowlist(policy, rules, serverName, toolName);

      case 'CAPABILITY_GATE':
        return this.evaluateCapabilityGate(policy, rules, serverName, toolName);

      case 'ARGUMENT_FILTER':
        return this.evaluateArgumentFilter(policy, rules, toolName, args || {});

      case 'RATE_LIMIT':
        // Rate limiting is handled at the gateway level
        return { allowed: true };

      case 'ANOMALY_DETECTION':
        // Anomaly detection is logged but doesn't block
        return { allowed: true };

      default:
        return { allowed: true };
    }
  }

  /**
   * Check if tool matches a deny pattern.
   */
  private evaluateDenylist(
    policy: any,
    rules: { patterns?: string[]; reason?: string },
    toolName: string
  ): PolicyEvaluationResult {
    if (!rules.patterns) {
      return { allowed: true };
    }

    for (const pattern of rules.patterns) {
      // Convert glob pattern to regex
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        'i'
      );

      if (regex.test(toolName)) {
        return {
          allowed: false,
          reason: rules.reason || `Tool '${toolName}' is blocked by policy`,
          policyName: policy.name,
          policyType: policy.type,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if tool is in the allowlist.
   */
  private evaluateAllowlist(
    policy: any,
    rules: { servers?: Record<string, { tools?: string[] }> },
    serverName: string,
    toolName: string
  ): PolicyEvaluationResult {
    if (!rules.servers) {
      return { allowed: true };
    }

    const serverConfig = rules.servers[serverName];
    if (!serverConfig) {
      // Server not in allowlist - this policy doesn't apply
      return { allowed: true };
    }

    if (!serverConfig.tools || serverConfig.tools.length === 0) {
      // All tools allowed for this server
      return { allowed: true };
    }

    if (!serverConfig.tools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not in the allowlist for server '${serverName}'`,
        policyName: policy.name,
        policyType: policy.type,
      };
    }

    return { allowed: true };
  }

  /**
   * Check capability gates (e.g., write operations require approval).
   */
  private async evaluateCapabilityGate(
    policy: any,
    rules: { capabilities?: string[]; action?: string; message?: string },
    serverName: string,
    toolName: string
  ): Promise<PolicyEvaluationResult> {
    if (!rules.capabilities) {
      return { allowed: true };
    }

    // Look up tool capabilities from database
    const toolSchema = await prisma.toolSchema.findFirst({
      where: {
        name: toolName,
        version: {
          server: {
            name: serverName,
          },
          status: 'APPROVED',
        },
      },
    });

    if (!toolSchema) {
      return { allowed: true };
    }

    // Check if tool has any gated capabilities
    const hasGatedCapability = rules.capabilities.some((cap: string) =>
      toolSchema.capabilities.includes(cap)
    );

    if (hasGatedCapability) {
      if (rules.action === 'require_approval') {
        return {
          allowed: false,
          reason: rules.message || `Tool requires approval for ${rules.capabilities.join(', ')} operations`,
          policyName: policy.name,
          policyType: policy.type,
          requiresApproval: true,
        };
      } else if (rules.action === 'block') {
        return {
          allowed: false,
          reason: rules.message || `Tool blocked: has ${rules.capabilities.join(', ')} capabilities`,
          policyName: policy.name,
          policyType: policy.type,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Filter/validate tool arguments.
   */
  private evaluateArgumentFilter(
    policy: any,
    rules: { tools?: Record<string, { disallowPatterns?: string[] }> },
    toolName: string,
    args: Record<string, unknown>
  ): PolicyEvaluationResult {
    if (!rules.tools) {
      return { allowed: true };
    }

    const toolConfig = rules.tools[toolName];
    if (!toolConfig || !toolConfig.disallowPatterns) {
      return { allowed: true };
    }

    // Check all argument values against disallow patterns
    const argsString = JSON.stringify(args).toUpperCase();

    for (const pattern of toolConfig.disallowPatterns) {
      if (argsString.includes(pattern.toUpperCase())) {
        return {
          allowed: false,
          reason: `Argument contains disallowed pattern: ${pattern}`,
          policyName: policy.name,
          policyType: policy.type,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check team-level access to server and tools.
   */
  private async checkTeamAccess(
    serverName: string,
    toolName: string,
    user: UserContext
  ): Promise<PolicyEvaluationResult> {
    const teamIds = user.teams.map((t) => t.teamId);

    if (teamIds.length === 0) {
      return {
        allowed: false,
        reason: 'User is not a member of any team',
      };
    }

    // Find server
    const server = await prisma.server.findFirst({
      where: { name: serverName },
    });

    if (!server) {
      return {
        allowed: false,
        reason: 'Server not found',
      };
    }

    // Check if any of user's teams have access
    const access = await prisma.teamServerAccess.findFirst({
      where: {
        serverId: server.id,
        teamId: { in: teamIds },
      },
    });

    if (!access) {
      return {
        allowed: false,
        reason: `No team access to server '${serverName}'`,
      };
    }

    // Check denied tools
    if (access.deniedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is denied for your team`,
      };
    }

    // Check allowed tools (if specified, must be in list)
    if (access.allowedTools.length > 0 && !access.allowedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not in your team's allowed list`,
      };
    }

    return { allowed: true };
  }
}
