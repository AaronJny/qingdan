import { AuthError, appMode, assertSameOrigin, csrfTokenForRequest, getLocalUser, loginLocalUser, logoutLocalUser, sessionCookie } from '../lib/auth.ts';

const PATHS = new Set(['/api/auth/me', '/api/auth/login', '/api/auth/logout']);
function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', ...extra } });
}

export async function dispatchAuth(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!PATHS.has(path)) return null;
  try {
    const expected = path === '/api/auth/me' ? 'GET' : 'POST';
    if (request.method !== expected) return json({ error: '请求方法不支持。' }, 405, { Allow: expected });
    if (path === '/api/auth/me') {
      const user = await getLocalUser(request);
      return json({ mode: appMode(), user, csrfToken: user ? csrfTokenForRequest(request) : null });
    }
    if (path === '/api/auth/logout') {
      await logoutLocalUser(request);
      return json({ mode: appMode(), user: null, csrfToken: null }, 200, { 'Set-Cookie': sessionCookie(null) });
    }
    assertSameOrigin(request);
    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new AuthError('请使用 JSON 登录请求。', 415);
    if (Number(request.headers.get('content-length') || 0) > 8192) throw new AuthError('登录请求过大。', 413);
    const reader = request.body?.getReader();
    let text = '', size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); throw new AuthError('登录请求过大。', 413); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new AuthError('登录请求格式无效。'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError('登录请求格式无效。');
    const result = await loginLocalUser(request, body);
    return json({ mode: appMode(), user: result.user, csrfToken: result.csrfToken }, 200, { 'Set-Cookie': result.cookie });
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.message, code: error.code }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
    // Do not log errors that might contain SQL bindings, passwords, or session cookies.
    return json({ error: '登录服务暂时不可用，请稍后重试。' }, 503);
  }
}
