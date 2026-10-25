import { readAgentConfiguration } from './descriptor.ts';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Readable } from 'node:stream';
import { AGENT_TOOLS } from '../lib/agent-tool-definitions.ts';
import { createGatewayInvoker } from './gateway.ts';
import { createQingdanMcpServer } from './server.ts';
import { createMcpInput } from './stdio-input.ts';

// The desktop entry observes this same stream for EOF. On Windows Electron,
// process.stdin itself is an immediate-EOF compatibility shim, not the pipe.
export let mcpInput: Readable | undefined;

try {
  const config = readAgentConfiguration(process.argv.slice(2), process.env);
  const invoke = createGatewayInvoker(config.endpoint, config.token);
  mcpInput = createMcpInput();
  mcpInput.once('error', () => { process.exitCode = 1; mcpInput?.destroy(); });
  const handle = serveStdio(() => createQingdanMcpServer(AGENT_TOOLS, invoke), {
    legacy: 'serve',
    transport: new StdioServerTransport(mcpInput, process.stdout),
    onerror: () => process.stderr.write('Qingdan MCP protocol error.\n'),
  });
  const close = () => { void handle.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  if (process.platform === 'win32' && (process.env.QINGDAN_AGENT_DESCRIPTOR || process.argv.includes('--descriptor'))) process.stderr.write('Private descriptors are not supported on Windows. Use QINGDAN_AGENT_ENDPOINT and QINGDAN_AGENT_TOKEN instead.\n');
  process.stderr.write('Qingdan MCP configuration is invalid. Check the private descriptor path, or the local gateway endpoint and agent token.\n');
  process.exitCode = 1;
}
