import { MCP_JSONRPC, createJsonRpcError, JSON_RPC_ERRORS } from '@mcp-manager/shared';

/**
 * MCP Proxy
 * 
 * Proxies MCP requests to backend servers.
 * 
 * In production, this would:
 * - Handle connection pooling
 * - Manage retries with exponential backoff
 * - Support both HTTP and SSE transports
 * - Track backend server health
 * 
 * For MVP, we do simple HTTP proxying.
 */
export class McpProxy {
  private timeout: number;

  constructor(timeoutMs: number = 30000) {
    this.timeout = timeoutMs;
  }

  /**
   * Proxy a raw JSON-RPC request to the backend.
   */
  async proxyRequest(endpoint: string, request: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { error?: { message?: string }; result: unknown };

      if (data.error) {
        throw new Error(data.error.message || 'Backend error');
      }

      return data.result;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Backend request timed out');
      }

      throw err;
    }
  }

  /**
   * Proxy a tools/call request to the backend.
   */
  async proxyToolCall(
    endpoint: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const request = {
      jsonrpc: MCP_JSONRPC.VERSION,
      id: Date.now().toString(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    return this.proxyRequest(endpoint, request);
  }

  /**
   * Proxy a tools/list request to the backend.
   */
  async proxyToolsList(endpoint: string): Promise<any> {
    const request = {
      jsonrpc: MCP_JSONRPC.VERSION,
      id: Date.now().toString(),
      method: 'tools/list',
      params: {},
    };

    return this.proxyRequest(endpoint, request);
  }

  /**
   * Initialize connection with backend.
   */
  async proxyInitialize(endpoint: string, clientInfo?: any): Promise<any> {
    const request = {
      jsonrpc: MCP_JSONRPC.VERSION,
      id: Date.now().toString(),
      method: 'initialize',
      params: {
        protocolVersion: MCP_JSONRPC.PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: clientInfo || {
          name: 'mcp-manager-gateway',
          version: '0.1.0',
        },
      },
    };

    return this.proxyRequest(endpoint, request);
  }
}
