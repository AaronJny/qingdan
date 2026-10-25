/** Protocol-neutral, deliberately narrow task capabilities. No account administration or raw HTTP. */
const id = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[-a-zA-Z0-9_:]+$' };
const operationId = { ...id, maxLength: 154 };
const date = { type: 'string', pattern: '^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };
const fields = {
  title: { type: 'string', minLength: 1, maxLength: 500 },
  description: { type: 'string', maxLength: 20000 },
  dueDate: date, startDate: date,
  priority: { type: 'integer', minimum: 0, maximum: 3 },
};
const page = { cursor: id, limit: { type: 'integer', minimum: 1, maximum: 50 } };
const mutation = { id, expectedRevision: { type: 'integer', minimum: 1 }, clientOperationId: operationId };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const AGENT_TOOLS = [
  { name: 'list_lists', description: 'List explicitly allowed active task lists. Paginated; no tasks, membership details or history.', inputSchema: schema(page), readOnly: true },
  { name: 'search_tasks', description: 'Search allowed tasks by title, list, status and due-date range. Returns summaries and a next cursor, not comments or attachments.', inputSchema: schema({ ...page, listId: id, status: { type: 'string', enum: ['open', 'done', 'wontdo'] }, query: { type: 'string', maxLength: 200 }, dueFrom: date, dueTo: date }), readOnly: true },
  { name: 'get_task', description: 'Read one allowed task, including its description but excluding comments, attachments and history.', inputSchema: schema({ id }, ['id']), readOnly: true },
  { name: 'create_task', description: 'Create one task in an explicitly writable list. Supply a new stable task id and operation id; reuse both unchanged for retries.', inputSchema: schema({ id, clientOperationId: operationId, listId: id, ...fields, parentId: id }, ['id', 'clientOperationId', 'listId', 'title']), readOnly: false },
  { name: 'update_task', description: 'Patch supported task fields without replacing other fields. Requires the last observed revision and a stable operation id. A conflict requires rereading and a new operation id.', inputSchema: schema({ ...mutation, changes: { ...schema(fields), minProperties: 1 } }, ['id', 'expectedRevision', 'clientOperationId', 'changes']), readOnly: false },
  { name: 'complete_task', description: 'Complete a task using Qingdan completion rules, including its subtasks and the next recurring instance. Requires revision and stable operation id. Do not retry with a new operation id after an uncertain result.', inputSchema: schema(mutation, ['id', 'expectedRevision', 'clientOperationId']), readOnly: false },
].map(({ readOnly, ...tool }) => ({ ...tool, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: true, openWorldHint: false } }));
export type AgentToolName = 'list_lists' | 'search_tasks' | 'get_task' | 'create_task' | 'update_task' | 'complete_task';
