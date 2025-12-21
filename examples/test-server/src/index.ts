import Fastify from 'fastify';
import cors from '@fastify/cors';

/**
 * A simple test MCP server that can be registered and tested through the MCP Manager.
 * This demonstrates what a typical backend MCP server looks like.
 */

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// MCP tools manifest
const TOOLS = [
  {
    name: 'echo',
    description: 'Echoes back the input message',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to echo back' },
      },
      required: ['message'],
    },
  },
  {
    name: 'get_time',
    description: 'Returns the current server time',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'calculate',
    description: 'Performs basic arithmetic operations',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { 
          type: 'string', 
          enum: ['add', 'subtract', 'multiply', 'divide'],
          description: 'The operation to perform',
        },
        a: { type: 'number', description: 'First operand' },
        b: { type: 'number', description: 'Second operand' },
      },
      required: ['operation', 'a', 'b'],
    },
  },
];

// Tool implementations
function executeTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'echo':
      return { echoed: args.message };
    
    case 'get_time':
      return { 
        iso: new Date().toISOString(),
        unix: Date.now(),
      };
    
    case 'calculate': {
      const a = args.a as number;
      const b = args.b as number;
      switch (args.operation) {
        case 'add': return { result: a + b };
        case 'subtract': return { result: a - b };
        case 'multiply': return { result: a * b };
        case 'divide': 
          if (b === 0) throw new Error('Division by zero');
          return { result: a / b };
        default:
          throw new Error(`Unknown operation: ${args.operation}`);
      }
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC handler
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

app.post('/mcp', async (request, reply) => {
  const rpc = request.body as JsonRpcRequest;
  
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: rpc.id,
  };

  try {
    switch (rpc.method) {
      case 'initialize':
        response.result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'test-mcp-server',
            version: '1.0.0',
          },
        };
        break;

      case 'tools/list':
        response.result = { tools: TOOLS };
        break;

      case 'tools/call': {
        const params = rpc.params as { name: string; arguments: Record<string, unknown> };
        const result = executeTool(params.name, params.arguments || {});
        response.result = {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
        break;
      }

      default:
        response.error = {
          code: -32601,
          message: `Method not found: ${rpc.method}`,
        };
    }
  } catch (error) {
    response.error = {
      code: -32000,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  return reply.send(response);
});

// Health check
app.get('/health', async () => ({ status: 'ok' }));

const PORT = parseInt(process.env.PORT || '8080', 10);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Test MCP server running on http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log('');
  console.log('Available tools:');
  TOOLS.forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
