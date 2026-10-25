import { AGENT_TOOLS, type AgentToolName } from './agent-tool-definitions';
import { ApiError, decode, find, saveRecord, validDate } from './server';
import { transitionTask } from './completion';
import { database } from './storage';
import type { AppRecord } from './types';

export type AgentScope = { listIds: string[]; writeEnabled: boolean };
const invalid = (message = 'Invalid tool arguments.') => new ApiError(message, 400);
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
/** Validate the small JSON-schema subset used by these six application capabilities.
 * SDK protocol validation is a second layer, never the authorization boundary. */
function check(value: any, spec: any): void {
  if (spec.type === 'object') {
    if (!object(value) || Object.keys(value).some(key => !Object.hasOwn(spec.properties, key)) || (spec.required || []).some((key: string) => !Object.hasOwn(value, key)) || Object.keys(value).length < (spec.minProperties || 0)) throw invalid();
    for (const key of Object.keys(value)) check(value[key], spec.properties[key]);
  } else if (spec.type === 'string') {
    if (typeof value !== 'string' || value.length < (spec.minLength || 0) || value.length > (spec.maxLength ?? Infinity) || (spec.pattern && !new RegExp(spec.pattern).test(value)) || (spec.enum && !spec.enum.includes(value))) throw invalid();
  } else if (spec.type === 'integer' && (!Number.isSafeInteger(value) || value < spec.minimum || value > (spec.maximum ?? Infinity))) throw invalid();
}
export function validateAgentCall(name: unknown, args: unknown): asserts name is AgentToolName {
  const definition = AGENT_TOOLS.find(tool => tool.name === name);
  if (!definition) throw invalid('Unknown task capability.');
  check(args, definition.inputSchema);
  for (const key of ['dueDate', 'startDate', 'dueFrom', 'dueTo']) {
    for (const source of [args, (args as any)?.changes]) if ((source as any)?.[key] && !validDate((source as any)[key])) throw invalid('Invalid date.');
  }
  if ((args as any).dueFrom && (args as any).dueTo && (args as any).dueFrom > (args as any).dueTo) throw invalid('Invalid date range.');
}
export function validateAgentScope(value: unknown): AgentScope {
  if (!object(value) || Object.keys(value).some(key => !['listIds', 'writeEnabled'].includes(key)) || typeof value.writeEnabled !== 'boolean' || !Array.isArray(value.listIds) || value.listIds.length > 100 || value.listIds.some((id: unknown) => typeof id !== 'string' || !/^[-a-zA-Z0-9_:]{1,160}$/.test(id))) throw invalid('Invalid access scope.');
  return { writeEnabled: value.writeEnabled, listIds: [...new Set(value.listIds as string[])] };
}
function summary(record: AppRecord, detail = false) {
  const data = record.data;
  return {
    id: record.id, listId: record.listId, revision: record.revision, updatedAt: record.updatedAt,
    title: data.title, status: data.status || 'open', priority: data.priority ?? 0,
    dueDate: data.dueDate || '', startDate: data.startDate || '', parentId: data.parentId || null,
    recurring: !!data.recurrence,
    ...(detail ? { description: data.description || '' } : {}),
  };
}
async function allowedList(id: string, userId: string, scope: AgentScope, write = false) {
  if (!scope.listIds.includes(id)) throw new ApiError('This list is outside the allowed scope.', 403);
  const list = await find(id, userId, write);
  if (list.kind !== 'list' || list.deleted || list.data.archived) throw new ApiError('List unavailable.', 404);
  return list;
}
async function allowedTask(id: string, userId: string, scope: AgentScope, write = false) {
  const task = await find(id, userId, write);
  if (task.kind !== 'task' || task.deleted || !task.listId) throw new ApiError('Task unavailable.', 404);
  await allowedList(task.listId, userId, scope, write);
  return task;
}

/** Shared business layer. The authenticated desktop gateway supplies a bounded
 * grant; all existing server-side ownership and edit permissions still apply. */
export async function executeAgentTool(userId: string, scopeInput: unknown, name: unknown, args: unknown) {
  validateAgentCall(name, args);
  const scope = validateAgentScope(scopeInput), input = args as Record<string, any>;
  const write = ['create_task', 'update_task', 'complete_task'].includes(name);
  if (write && !scope.writeEnabled) throw new ApiError('Agent access is read-only.', 403);
  if (name === 'get_task') return { task: summary(await allowedTask(input.id, userId, scope), true) };
  if (name === 'list_lists' || name === 'search_tasks') {
    if (!scope.listIds.length) return { items: [], nextCursor: null };
    if (input.listId && !scope.listIds.includes(input.listId)) throw new ApiError('This list is outside the allowed scope.', 403);
    const lists = name === 'list_lists', limit = input.limit ?? 20;
    const clauses = ["r.deleted=0", lists ? "r.kind='list' AND COALESCE(json_extract(r.data,'$.archived'),0)=0" : "r.kind='task'", `(r.owner_id=? OR m.user_id IS NOT NULL)`, `${lists ? 'r.id' : 'r.list_id'} IN (${scope.listIds.map(() => '?').join(',')})`, 'r.id>?'];
    const values: any[] = [userId, ...scope.listIds, input.cursor || ''];
    if (!lists) {
      clauses.push("EXISTS(SELECT 1 FROM records l WHERE l.id=r.list_id AND l.kind='list' AND l.deleted=0 AND COALESCE(json_extract(l.data,'$.archived'),0)=0 AND (l.owner_id=? OR EXISTS(SELECT 1 FROM members lm WHERE lm.list_id=l.id AND lm.user_id=?)))");
      values.push(userId, userId);
      if (input.listId) { clauses.push('r.list_id=?'); values.push(input.listId); }
      if (input.status) { clauses.push("COALESCE(json_extract(r.data,'$.status'),'open')=?"); values.push(input.status); }
      if (input.query) { clauses.push("instr(lower(json_extract(r.data,'$.title')),lower(?))>0"); values.push(input.query); }
      if (input.dueFrom) { clauses.push("json_extract(r.data,'$.dueDate')>=?"); values.push(input.dueFrom); }
      if (input.dueTo) { clauses.push("COALESCE(json_extract(r.data,'$.dueDate'),'')<>'' AND json_extract(r.data,'$.dueDate')<=?"); values.push(input.dueTo); }
    }
    const rows = await database().prepare(`SELECT r.*,CASE WHEN r.owner_id=? THEN 'owner' ELSE m.role END role FROM records r LEFT JOIN members m ON m.list_id=${lists ? 'r.id' : 'r.list_id'} AND m.user_id=? WHERE ${clauses.join(' AND ')} ORDER BY r.id LIMIT ?`).bind(userId, userId, ...values, limit + 1).all();
    const records = rows.results.slice(0, limit).map(decode);
    return { items: records.map(record => lists ? { id: record.id, title: record.data.title, revision: record.revision, writable: scope.writeEnabled && ['owner', 'edit'].includes(record.role!) } : summary(record)), nextCursor: rows.results.length > limit ? records.at(-1)!.id : null };
  }
  // Namespace operation IDs so agents cannot accidentally collide with UI receipts.
  const operationId = 'agent:' + input.clientOperationId;
  if (operationId.length > 160) throw invalid('Operation id must contain at most 154 characters.');
  if (name === 'create_task') {
    await allowedList(input.listId, userId, scope, true);
    if (input.parentId) { const parent = await allowedTask(input.parentId, userId, scope, true); if (parent.listId !== input.listId) throw invalid('Parent must be in the same list.'); }
    const { id, clientOperationId: _operation, ...fields } = input;
    const record = await saveRecord({ id, kind: 'task', data: { ...fields, status: 'open', taskType: 'task' }, expectedRevision: 0, clientOperationId: operationId }, userId);
    // Receipt replays return current state, which may have moved since creation.
    const visible = await allowedTask(record.id, userId, scope);
    return { task: summary(visible, true), replayed: !!('replayed' in record && record.replayed) };
  }
  const current = await allowedTask(input.id, userId, scope, true);
  if (name === 'update_task') {
    const record = await saveRecord({ id: input.id, kind: 'task', data: { ...current.data, ...input.changes }, expectedRevision: input.expectedRevision, clientOperationId: operationId }, userId, { agentPatch: input });
    return { task: summary(await allowedTask(record.id, userId, scope), true), replayed: !!('replayed' in record && record.replayed) };
  }
  const completed = await transitionTask(current.id, input.expectedRevision, userId, 'done', false, operationId);
  // Completion may create recurring instances or complete a subtree. Never leak
  // records that were moved to another scope after a receipt was first written.
  const records: AppRecord[] = [];
  for (const record of completed.records) {
    try { records.push(await allowedTask(record.id, userId, scope)); }
    catch (error) { if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error; }
  }
  return { tasks: records.map(record => summary(record)), nextTaskId: records.some(record => record.id === completed.next) ? completed.next : null, replayed: !!('replayed' in completed && completed.replayed) };
}
