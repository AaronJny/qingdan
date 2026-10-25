import { readAgentConfiguration } from './descriptor.ts';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { AGENT_TOOLS } from '../lib/agent-tool-definitions.ts';
import { createGatewayInvoker } from './gateway.ts';
import { createQingdanMcpServer } from './server.ts';

try {
  const config = readAgentConfiguration(process.argv.slice(2), process.env);
  const invoke = createGatewayInvoker(config.endpoint, config.token);
  const handle = serveStdio(() => createQingdanMcpServer(AGENT_TOOLS, invoke), {
    legacy: 'serve',
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
