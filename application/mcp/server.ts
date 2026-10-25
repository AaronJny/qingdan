import { GatewayError } from './errors.ts';
import applicationPackage from '../package.json' with { type: 'json' };
import { McpServer, fromJsonSchema, type JsonSchemaType, type ToolAnnotations } from '@modelcontextprotocol/server';

export interface QingdanToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/** Only the dedicated Qingdan gateway may implement this capability boundary. */
export type InvokeQingdanTool = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

/** SDK owns framing, discovery/initialize, validation and protocol-version handling. */
export function createQingdanMcpServer(tools: readonly QingdanToolDefinition[], invoke: InvokeQingdanTool) {
  const server = new McpServer({ name: 'qingdan', version: applicationPackage.version });
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType),
      annotations: tool.annotations,
    }, async (args, context) => {
      try {
        const result = await invoke(tool.name, args, context.mcpReq.signal);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } };
      } catch (error) {
        // Never echo transport errors, URLs, headers or upstream response bodies.
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof GatewayError ? error.message : 'Qingdan could not complete this operation. Check the desktop connection and inspect task state before retrying a write.' }],
          structuredContent: { error: { code: error instanceof GatewayError ? error.code : 'UNAVAILABLE' } },
        };
      }
    });
  }
  return server;
}
