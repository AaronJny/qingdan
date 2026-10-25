import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, parse, resolve } from 'node:path';
import { parseGatewayEndpoint } from './gateway.ts';

export interface AgentConnection { endpoint: string; token: string }

/** Read once at startup. A running MCP connection must never adopt a rotated grant. */
export function readAgentDescriptor(file: string): AgentConnection {
  if (process.platform === 'win32') throw new Error('Descriptor access is unavailable on Windows; use explicit endpoint and token configuration.');
  if (!isAbsolute(file) || resolve(file) !== file || !process.getuid) throw new Error('Descriptor path must be absolute and canonical.');
  const uid = process.getuid();
  const parent = dirname(file);
  // A symlink in the parent chain could redirect the private file check.
  for (let current = parent; current !== parse(current).root; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Descriptor parent must not be a symlink.');
  }
  const directory = lstatSync(parent);
  if (directory.uid !== uid || (directory.mode & 0o077) !== 0) throw new Error('Descriptor directory must be private to its owner.');
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid || (before.mode & 0o077) !== 0 || before.nlink !== 1) throw new Error('Descriptor must be a private owner-only regular file.');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.uid !== uid || (opened.mode & 0o077) !== 0 || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > 16 * 1024) throw new Error('Descriptor changed or is unsafe.');
    const buffer = Buffer.alloc(16 * 1024 + 1);
    let bytes = 0, count = 0;
    while (bytes < buffer.length && (count = readSync(fd, buffer, bytes, buffer.length - bytes, null)) > 0) bytes += count;
    if (bytes > 16 * 1024) throw new Error('Descriptor is too large.');
    const raw = buffer.subarray(0, bytes).toString('utf8');
    const after = fstatSync(fd), pathAfter = lstatSync(file), directoryAfter = lstatSync(parent);
    if (raw.length > 16 * 1024 || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || directoryAfter.dev !== directory.dev || directoryAfter.ino !== directory.ino || directoryAfter.uid !== uid || (directoryAfter.mode & 0o077) !== 0 || after.uid !== uid || (after.mode & 0o077) !== 0 || after.nlink !== 1) throw new Error('Descriptor changed while being read.');
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid descriptor.');
    const value = data as Record<string, unknown>;
    if (value.schemaVersion !== 1 || typeof value.endpoint !== 'string' || typeof value.token !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(value.token)) throw new Error('Invalid descriptor.');
    parseGatewayEndpoint(value.endpoint);
    const binding = value.binding as Record<string, unknown> | undefined;
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) || typeof binding.id !== 'string' || !/^[a-f0-9]{64}$/.test(binding.id) || !['builtin', 'server'].includes(String(binding.mode)) || typeof binding.origin !== 'string' || typeof binding.accountId !== 'string' || !binding.accountId) throw new Error('Invalid descriptor binding.');
    const bindingId = createHash('sha256').update(JSON.stringify([1, binding.mode, binding.origin, binding.accountId])).digest('hex');
    if (binding.id !== bindingId || basename(file) !== `${bindingId}.json`) throw new Error('Descriptor does not match its configured account binding.');
    return { endpoint: value.endpoint, token: value.token };
  } finally { closeSync(fd); }
}

export function readAgentConfiguration(args: string[], env: NodeJS.ProcessEnv): AgentConnection {
  let descriptor = env.QINGDAN_AGENT_DESCRIPTOR;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--descriptor' || !args[1]) throw new Error('Only --descriptor /absolute/path is supported.');
    descriptor = args[1];
  }
  if (descriptor) return readAgentDescriptor(descriptor);
  return { endpoint: env.QINGDAN_AGENT_ENDPOINT || '', token: env.QINGDAN_AGENT_TOKEN || '' };
}
