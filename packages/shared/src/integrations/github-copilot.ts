/**
 * GitHub Copilot Enterprise Integration
 * 
 * Syncs approved MCP servers from MCP Manager to GitHub Copilot Enterprise's
 * MCP server allowlist. Supports both:
 * 
 * 1. ENTERPRISE-LEVEL: All users under an enterprise (no orgs)
 *    - API: /enterprises/{enterprise}/copilot/mcp-servers
 * 
 * 2. ORGANIZATION-LEVEL: Users organized into orgs under enterprise
 *    - API: /orgs/{org}/copilot/mcp-servers
 * 
 * This integration:
 * 1. Pushes approved servers to GitHub's allowlist when approved in MCP Manager
 * 2. Removes servers from GitHub's allowlist when revoked
 * 3. Can sync the entire allowlist on demand
 * 
 * Authentication:
 * - Requires a GitHub App with enterprise or org admin permissions
 * - Enterprise: `manage_billing:enterprise`, `admin:enterprise`
 * - Organization: `admin:org`, `manage_billing:copilot`
 * 
 * API Reference:
 * - Enterprise: GET/PUT /enterprises/{enterprise}/copilot/mcp-servers
 * - Organization: GET/PUT /orgs/{org}/copilot/mcp-servers
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('github-copilot-integration');

export type GitHubScopeLevel = 'enterprise' | 'organization';

export interface GitHubCopilotConfig {
  /** GitHub API base URL (for GHES, use your instance URL + /api/v3) */
  apiBaseUrl: string;
  
  /** 
   * Scope level: 'enterprise' or 'organization'
   * - 'enterprise': For enterprise accounts without separate orgs
   * - 'organization': For orgs within an enterprise
   */
  scopeLevel: GitHubScopeLevel;
  
  /** Enterprise slug (required if scopeLevel is 'enterprise') */
  enterpriseName?: string;
  
  /** Organization name (required if scopeLevel is 'organization') */
  orgName?: string;
  
  /** GitHub App installation token or PAT */
  authToken: string;
  
  /** Whether to auto-sync on approval/revocation */
  autoSync: boolean;
}

export interface GitHubMcpServerEntry {
  /** Unique identifier for the MCP server */
  name: string;
  /** Display name shown to users */
  displayName: string;
  /** Description of what the server does */
  description?: string;
  /** The MCP server endpoint URL */
  url: string;
  /** Whether the server is enabled */
  enabled: boolean;
  /** Optional: Categories/tags for the server */
  categories?: string[];
  /** Optional: Icon URL */
  iconUrl?: string;
}

export interface SyncResult {
  success: boolean;
  added: string[];
  removed: string[];
  unchanged: string[];
  errors: Array<{ server: string; error: string }>;
}

/**
 * GitHub Copilot Enterprise MCP Server Manager
 * 
 * Example usage for ENTERPRISE (no orgs):
 * ```typescript
 * const manager = new GitHubCopilotMcpManager({
 *   apiBaseUrl: 'https://github.your-company.com/api/v3',
 *   scopeLevel: 'enterprise',
 *   enterpriseName: 'my-enterprise',
 *   authToken: process.env.GITHUB_TOKEN,
 *   autoSync: true,
 * });
 * ```
 * 
 * Example usage for ORGANIZATION:
 * ```typescript
 * const manager = new GitHubCopilotMcpManager({
 *   apiBaseUrl: 'https://api.github.com',
 *   scopeLevel: 'organization',
 *   orgName: 'my-org',
 *   authToken: process.env.GITHUB_TOKEN,
 *   autoSync: true,
 * });
 * ```
 */
export class GitHubCopilotMcpManager {
  private config: GitHubCopilotConfig;
  
  constructor(config: GitHubCopilotConfig) {
    this.config = config;
    
    // Validate config
    if (config.scopeLevel === 'enterprise' && !config.enterpriseName) {
      throw new Error('enterpriseName is required when scopeLevel is "enterprise"');
    }
    if (config.scopeLevel === 'organization' && !config.orgName) {
      throw new Error('orgName is required when scopeLevel is "organization"');
    }
  }

  /**
   * Get the base path for MCP server API calls
   */
  private getBasePath(): string {
    if (this.config.scopeLevel === 'enterprise') {
      return `${this.config.apiBaseUrl}/enterprises/${this.config.enterpriseName}/copilot/mcp-servers`;
    } else {
      return `${this.config.apiBaseUrl}/orgs/${this.config.orgName}/copilot/mcp-servers`;
    }
  }

  /**
   * Get scope identifier for logging
   */
  private getScopeId(): string {
    return this.config.scopeLevel === 'enterprise' 
      ? `enterprise:${this.config.enterpriseName}`
      : `org:${this.config.orgName}`;
  }

  /**
   * Get the current MCP server allowlist from GitHub Copilot Enterprise
   */
  async getServers(): Promise<GitHubMcpServerEntry[]> {
    const url = this.getBasePath();
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          // MCP servers not configured yet, return empty list
          return [];
        }
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { servers?: GitHubMcpServerEntry[] };
      return data.servers || [];
    } catch (error) {
      logger.error({ error, url, scope: this.getScopeId() }, 'Failed to fetch GitHub Copilot MCP servers');
      throw error;
    }
  }

  /**
   * Add or update an MCP server in GitHub Copilot's allowlist
   */
  async addServer(server: GitHubMcpServerEntry): Promise<void> {
    const url = `${this.getBasePath()}/${server.name}`;
    
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({
          display_name: server.displayName,
          description: server.description,
          url: server.url,
          enabled: server.enabled,
          categories: server.categories,
          icon_url: server.iconUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub API error: ${response.status} - ${error}`);
      }

      logger.info({ server: server.name, scope: this.getScopeId() }, 'Added server to GitHub Copilot allowlist');
    } catch (error) {
      logger.error({ error, server: server.name, scope: this.getScopeId() }, 'Failed to add server to GitHub Copilot');
      throw error;
    }
  }

  /**
   * Remove an MCP server from GitHub Copilot's allowlist
   */
  async removeServer(serverName: string): Promise<void> {
    const url = `${this.getBasePath()}/${serverName}`;
    
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      if (!response.ok && response.status !== 404) {
        const error = await response.text();
        throw new Error(`GitHub API error: ${response.status} - ${error}`);
      }

      logger.info({ server: serverName, scope: this.getScopeId() }, 'Removed server from GitHub Copilot allowlist');
    } catch (error) {
      logger.error({ error, server: serverName, scope: this.getScopeId() }, 'Failed to remove server from GitHub Copilot');
      throw error;
    }
  }

  /**
   * Enable or disable a server in the allowlist
   */
  async setServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    const servers = await this.getServers();
    const server = servers.find(s => s.name === serverName);
    
    if (!server) {
      throw new Error(`Server ${serverName} not found in GitHub Copilot allowlist`);
    }

    await this.addServer({ ...server, enabled });
  }

  /**
   * Sync the GitHub Copilot allowlist with MCP Manager's approved servers.
   * 
   * This will:
   * - Add servers that are approved in MCP Manager but not in GitHub
   * - Remove servers that are in GitHub but not approved in MCP Manager
   * - Update servers that exist in both
   */
  async syncFromRegistry(
    approvedServers: Array<{
      name: string;
      displayName: string;
      description?: string;
      endpoint: string;
      categories?: string[];
    }>
  ): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      added: [],
      removed: [],
      unchanged: [],
      errors: [],
    };

    try {
      // Get current GitHub allowlist
      const currentServers = await this.getServers();
      const currentNames = new Set(currentServers.map(s => s.name));
      const approvedNames = new Set(approvedServers.map(s => s.name));

      // Add or update approved servers
      for (const server of approvedServers) {
        try {
          const exists = currentNames.has(server.name);
          await this.addServer({
            name: server.name,
            displayName: server.displayName,
            description: server.description,
            url: server.endpoint,
            enabled: true,
            categories: server.categories,
          });
          
          if (exists) {
            result.unchanged.push(server.name);
          } else {
            result.added.push(server.name);
          }
        } catch (error) {
          result.errors.push({
            server: server.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Remove servers not in approved list
      for (const current of currentServers) {
        if (!approvedNames.has(current.name)) {
          try {
            await this.removeServer(current.name);
            result.removed.push(current.name);
          } catch (error) {
            result.errors.push({
              server: current.name,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }

      result.success = result.errors.length === 0;
      
      logger.info({
        added: result.added.length,
        removed: result.removed.length,
        unchanged: result.unchanged.length,
        errors: result.errors.length,
      }, 'GitHub Copilot sync completed');

    } catch (error) {
      logger.error({ error }, 'GitHub Copilot sync failed');
      result.success = false;
      result.errors.push({
        server: '*',
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    }

    return result;
  }

  /**
   * Validate the GitHub connection and permissions
   */
  async validateConnection(): Promise<{
    valid: boolean;
    scopeLevel: GitHubScopeLevel;
    scopeName: string;
    copilotEnabled: boolean;
    mcpEnabled: boolean;
    error?: string;
  }> {
    const scopeName = this.config.scopeLevel === 'enterprise' 
      ? this.config.enterpriseName! 
      : this.config.orgName!;
      
    try {
      // Check scope access (enterprise or org)
      let accessUrl: string;
      let billingUrl: string;
      
      if (this.config.scopeLevel === 'enterprise') {
        accessUrl = `${this.config.apiBaseUrl}/enterprises/${this.config.enterpriseName}`;
        billingUrl = `${this.config.apiBaseUrl}/enterprises/${this.config.enterpriseName}/copilot/billing`;
      } else {
        accessUrl = `${this.config.apiBaseUrl}/orgs/${this.config.orgName}`;
        billingUrl = `${this.config.apiBaseUrl}/orgs/${this.config.orgName}/copilot/billing`;
      }
      
      const accessResponse = await fetch(accessUrl, {
        headers: this.getHeaders(),
      });

      if (!accessResponse.ok) {
        return {
          valid: false,
          scopeLevel: this.config.scopeLevel,
          scopeName,
          copilotEnabled: false,
          mcpEnabled: false,
          error: `Cannot access ${this.config.scopeLevel}: ${accessResponse.status}`,
        };
      }

      // Check Copilot settings
      const copilotResponse = await fetch(billingUrl, {
        headers: this.getHeaders(),
      });

      const copilotEnabled = copilotResponse.ok;

      // Check MCP servers endpoint
      const mcpUrl = this.getBasePath();
      const mcpResponse = await fetch(mcpUrl, {
        headers: this.getHeaders(),
      });

      // 404 means endpoint exists but no servers configured (OK)
      // 403 means no permission or feature not enabled
      const mcpEnabled = mcpResponse.ok || mcpResponse.status === 404;

      return {
        valid: true,
        scopeLevel: this.config.scopeLevel,
        scopeName,
        copilotEnabled,
        mcpEnabled,
      };
    } catch (error) {
      return {
        valid: false,
        scopeLevel: this.config.scopeLevel,
        scopeName,
        copilotEnabled: false,
        mcpEnabled: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.authToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }
}

/**
 * Create a GitHub Copilot manager from environment variables
 * 
 * Environment Variables:
 * - GITHUB_SCOPE_LEVEL: 'enterprise' or 'organization' (default: 'enterprise')
 * - GITHUB_ENTERPRISE_NAME: Enterprise slug (required if scope is 'enterprise')
 * - GITHUB_ORG: Organization name (required if scope is 'organization')
 * - GITHUB_TOKEN: GitHub App installation token or PAT
 * - GITHUB_API_URL: API base URL (default: https://api.github.com)
 * - GITHUB_AUTO_SYNC: 'true' to auto-sync on approval/revoke
 */
export function createGitHubCopilotManager(): GitHubCopilotMcpManager | null {
  const token = process.env.GITHUB_TOKEN;
  const scopeLevel = (process.env.GITHUB_SCOPE_LEVEL as GitHubScopeLevel) || 'enterprise';
  const enterpriseName = process.env.GITHUB_ENTERPRISE_NAME;
  const orgName = process.env.GITHUB_ORG;
  
  if (!token) {
    logger.warn('GitHub Copilot integration not configured (missing GITHUB_TOKEN)');
    return null;
  }
  
  if (scopeLevel === 'enterprise' && !enterpriseName) {
    logger.warn('GitHub Copilot integration not configured (missing GITHUB_ENTERPRISE_NAME)');
    return null;
  }
  
  if (scopeLevel === 'organization' && !orgName) {
    logger.warn('GitHub Copilot integration not configured (missing GITHUB_ORG)');
    return null;
  }

  return new GitHubCopilotMcpManager({
    apiBaseUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
    scopeLevel,
    enterpriseName,
    orgName,
    authToken: token,
    autoSync: process.env.GITHUB_AUTO_SYNC === 'true',
  });
}
