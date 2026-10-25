import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
if (!existsSync('dist/server/mcp.mjs')) throw new Error('Build the application before testing the packaged MCP entry.');
const files = readdirSync('mcp').filter(name => name.endsWith('.test.ts')).map(name => `mcp/${name}`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit', env: { ...process.env, QINGDAN_TEST_BUILT_MCP: '1' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
