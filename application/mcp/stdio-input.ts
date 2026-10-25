import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

type Runtime = { platform: string; versions: { node?: string; electron?: string }; stdin: Readable };

/** Electron's Windows process.stdin is an immutable, immediate-EOF shim.
 * Read only the inherited stdio descriptor instead; never open another file.
 * https://github.com/electron/electron/blob/v44.6.0/lib/common/init.ts#L56-L68
 */
export function createMcpInput(runtime: Runtime = process, open: (file: string, options: { fd: number; autoClose: boolean }) => Readable = createReadStream): Readable {
  if (runtime.platform === 'win32' && runtime.versions.electron) {
    return open('', { fd: 0, autoClose: false });
  }
  return runtime.stdin;
}
