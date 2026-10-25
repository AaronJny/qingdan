import { request } from 'node:http';
import { GatewayError } from './errors.ts';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Validate the spelling too: URL normalization must not admit numeric IP aliases. */
export function parseGatewayEndpoint(value: string): URL {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/tools$/.test(value)) {
    throw new Error('Qingdan gateway must be a literal-loopback /tools endpoint.');
  }
  const url = new URL(value);
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) throw new Error('Invalid gateway port.');
  return url;
}

export function createGatewayInvoker(endpointValue: string, token: string) {
  const endpoint = parseGatewayEndpoint(endpointValue);
  if (!token || !/^[\x21-\x7e]{16,4096}$/.test(token)) throw new Error('A Qingdan agent token is required.');
  return async (name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
    const body = JSON.stringify({ name, arguments: args });
    // node:http does not consult HTTP_PROXY or follow redirects. No browser session is used.
    return new Promise((resolve, reject) => {
      const req = request(endpoint, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, response => {
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('Qingdan gateway response is too large.'));
          } else chunks.push(chunk);
        });
        response.on('error', () => reject(new Error('Qingdan gateway response failed.')));
        response.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 200) {
              const fallback = response.statusCode === 401 || response.statusCode === 403 ? 'DENIED' : response.statusCode === 409 ? 'CONFLICT' : 'UNAVAILABLE';
              reject(new GatewayError(payload?.code || fallback));
            } else if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'result')) {
              reject(new GatewayError('UNAVAILABLE'));
            } else resolve(payload.result);
          }
          catch { reject(new Error('Qingdan gateway returned invalid JSON.')); }
        });
      });
      const timeout = setTimeout(() => req.destroy(new Error('Qingdan gateway timed out.')), 30_000);
      timeout.unref();
      req.on('close', () => clearTimeout(timeout));
      req.on('error', () => reject(new Error('Qingdan gateway connection failed.')));
      req.end(body);
    });
  };
}
