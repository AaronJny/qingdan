import { AuthError, assertAccountsMode, assertCsrf, createLocalUser, disableLocalUser, enableLocalUser, getLocalUser, listLocalUsers, managedUserById, setLocalPassword, setLocalRole } from '../lib/auth.ts';

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...extra } });
}

export async function dispatchUsers(request: Request): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/auth/users') return null;
  try {
    assertAccountsMode();
    if (!['GET', 'POST'].includes(request.method)) return json({ error: '请求方法不支持。' }, 405, { Allow: 'GET, POST' });
    if (request.method === 'POST') assertCsrf(request);
    const actor = await getLocalUser(request);
    if (!actor) throw new AuthError('请先登录。', 401);
    if (actor.role !== 'admin') throw new AuthError('只有管理员可以管理账号。', 403);
    if (request.method === 'GET') return json({ users: await listLocalUsers() });
    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new AuthError('请使用 JSON 请求。', 415);
    if (Number(request.headers.get('content-length') || 0) > 8192) throw new AuthError('请求过大。', 413);
    const reader = request.body?.getReader();
    let text = '', size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); throw new AuthError('请求过大。', 413); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    let input: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      input = parsed as Record<string, unknown>;
    } catch { throw new AuthError('请求格式无效。'); }
    if (input.operation === 'create') {
      if (typeof input.email !== 'string' || typeof input.password !== 'string' || typeof input.displayName !== 'string' || (input.role !== undefined && input.role !== 'admin' && input.role !== 'user')) throw new AuthError('账号信息无效。');
      const user = await createLocalUser({ email: input.email, password: input.password, displayName: input.displayName, role: input.role }, { actorId: actor.userId });
      return json({ ok: true, user: await managedUserById(user.userId) }, 201);
    }
    const target = await managedUserById(input.userId);
    if (input.operation === 'disable') await disableLocalUser(target.email, actor.userId);
    else if (input.operation === 'enable') await enableLocalUser(target.userId, actor.userId);
    else if (input.operation === 'role') await setLocalRole(target.userId, input.role, actor.userId);
    else if (input.operation === 'password') {
      if (typeof input.password !== 'string') throw new AuthError('请输入新密码。');
      await setLocalPassword(target.email, input.password, actor.userId);
    } else throw new AuthError('账号管理操作无效。');
    return json({ ok: true, user: await managedUserById(target.userId) });
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: '账号管理服务暂时不可用，请稍后重试。' }, 503);
  }
}
