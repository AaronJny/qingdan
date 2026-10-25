import { identity, secureWrite, ApiError } from '../lib/server';
import { AuthError } from '../lib/auth';
import { OperationConflict } from '../lib/operations';
import { executeAgentTool } from '../lib/agent-capabilities';

/** Same authenticated application channel used by the desktop. This is not an
 * anonymous MCP endpoint and accepts neither gateway tokens nor arbitrary URLs. */
export async function dispatchAgent(request: Request): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/agent/tools') return null;
  if (request.method !== 'POST') return Response.json({ error: 'Use POST.', code: 'INVALID_ARGUMENT' }, { status: 405, headers: { Allow: 'POST' } });
  try {
    secureWrite(request);
    const user = await identity(request);
    if ((request.headers.get('content-type') || '').split(';')[0] !== 'application/json') throw new ApiError('JSON required.', 415);
    const text = await request.text();
    if (Buffer.byteLength(text) > 32768) throw new ApiError('Tool request too large.', 413);
    let body: any;
    try { body = JSON.parse(text); } catch { throw new ApiError('Invalid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['name', 'arguments', 'scope'].includes(key))) throw new ApiError('Invalid request.');
    return Response.json({ result: await executeAgentTool(user.userId, body.scope, body.name, body.arguments) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof OperationConflict ? 409 : error instanceof ApiError || error instanceof AuthError ? error.status : 503;
    const code = status === 409 ? 'CONFLICT' : [401, 403].includes(status) ? 'DENIED' : status === 404 ? 'NOT_FOUND' : status < 500 ? 'INVALID_ARGUMENT' : 'UNAVAILABLE';
    // No stack traces, SQL bindings, task descriptions or credentials in failures.
    const messages: Record<string, string> = { CONFLICT: 'The record or operation changed. Read the current task before making a new change.', DENIED: 'The session or permission does not allow this operation.', NOT_FOUND: 'The task or list is unavailable.', INVALID_ARGUMENT: 'The request contains invalid or unsupported arguments.', UNAVAILABLE: 'The task service is unavailable. Do not assume a write failed; retry the same operation id after checking access.' };
    return Response.json({ error: messages[code], code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
