import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { Bootstrap, AppRecord } from '../lib/types';
import type { AgentAccessSettings, AgentAccessUpdate } from '../lib/desktop-connection';
const window: any = new Window({ url: 'https://synthetic.example.test/' });
for (const key of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLInputElement', 'Event', 'CustomEvent', 'MutationObserver', 'sessionStorage', 'localStorage']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).fetch = async () => { throw new Error('Agent UI must use the desktop bridge, not HTTP'); };
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: AgentAccessSettingsPanel, agentClientConfig } = await import('../app/agent-access-settings');
const { SettingsDialog } = await import('../app/workspace-dialogs');
const { setLanguagePreference, messages } = await import('../lib/i18n');
const user = { userId: 'synthetic-account', displayName: 'Synthetic account', email: 'synthetic@example.test', mode: 'accounts' as const };
const record = (id: string, deleted = false): AppRecord => ({ id, kind: 'list', ownerId: user.userId, listId: null, data: { title: id === 'list-a' ? 'List A' : id === 'list-b' ? 'List B' : id }, revision: 1, updatedAt: '2026-01-01T00:00:00Z', deleted });
const state: Bootstrap = { user, records: [record('list-a'), record('list-b'), record('Deleted', true)], history: [], members: [], attachments: [], serverTime: '2026-01-01T00:00:00Z' };
const base: AgentAccessSettings = { enabled: false, writeEnabled: false, listIds: [], tokenConfigured: false, serverUrl: 'https://synthetic.example.test', accountId: user.userId, endpoint: null, descriptorPath: null, sessionOnly: true };

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale}: explicit scope, review and token generation; no stored or redisplayed secrets`, async () => {
    localStorage.clear(); setLanguagePreference(locale);
    const label = (key: string) => messages[locale]['agentAccess.' + key];
    let current = { ...base };
    let reads = 0;
    const writes: AgentAccessUpdate[] = [];
    const secret = 'synthetic-test-token-not-a-real-credential';
    window.qingdanDesktop = {
      getConnection: async () => ({ mode: 'server', serverUrl: base.serverUrl, status: 'connected', serverMode: 'accounts' }),
      openConnectionSettings: async () => ({ ok: true }),
      getAgentAccess: async (id: string) => { assert.equal(id, user.userId); reads++; return current; },
      saveAgentAccess: async (id: string, update: AgentAccessUpdate) => {
        assert.equal(id, user.userId); writes.push(update);
        current = { ...base, ...update, tokenConfigured: update.enabled, endpoint: update.enabled ? 'http://127.0.0.1:32123/tools' : null };
        return { ...current, ...(update.rotateToken ? { token: secret } : {}) };
      },
    };
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const button = (key: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(element => element.textContent === label(key))!;
    const checkbox = (text: string) => Array.from(host.querySelectorAll<HTMLLabelElement>('label')).find(element => element.textContent === text)!.querySelector<HTMLInputElement>('input')!;
    try {
      await act(async () => root.render(<AgentAccessSettingsPanel state={state} />));
      assert.equal(reads, 1); assert.equal(writes.length, 0);
      assert.equal(button('enable').disabled, true);
      assert.equal(host.textContent!.includes('Deleted'), false);
      assert.equal(checkbox(label('write')).checked, false);
      await act(async () => checkbox('List A').click());
      assert.equal(button('enable').disabled, true);
      await act(async () => checkbox(label('review')).click());
      assert.equal(button('enable').disabled, false);
      await act(async () => button('enable').click());
      assert.deepEqual(writes, [{ enabled: true, writeEnabled: false, listIds: ['list-a'], rotateToken: true }]);
      assert.equal(host.querySelector<HTMLInputElement>(`input[aria-label="${label('token')}"]`)!.value, secret);
      assert.ok(host.querySelector('pre')!.textContent!.includes('QINGDAN_AGENT_TOKEN'));
      assert.equal(host.querySelector('pre')!.textContent!.includes(secret), false);
      assert.equal(JSON.stringify(localStorage).includes(secret), false);
      assert.equal(location.href.includes(secret), false);
      await act(async () => button('clear').click());
      assert.equal(host.querySelector(`input[aria-label="${label('token')}"]`), null);
      await act(async () => checkbox(label('review')).click());
      await act(async () => checkbox('List B').click());
      assert.equal(checkbox(label('review')).checked, false, 'Changed scope needs a new review');
      await act(async () => root.render(null));
      await act(async () => root.render(<AgentAccessSettingsPanel state={state} />));
      assert.equal(host.querySelector(`input[aria-label="${label('token')}"]`), null, 'Previously generated token is not fetched again');
      await act(async () => button('revoke').click());
      assert.deepEqual(writes.at(-1), { enabled: false, writeEnabled: false, listIds: [] });
      assert.equal(host.querySelector('pre'), null);
      assert.equal(button('enable').disabled, true);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
}

test('Agent settings tab is absent without the desktop capability bridge and reads lazily', async () => {
  setLanguagePreference('en'); delete window.qingdanDesktop;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const actions: any = { save: () => assert.fail('Unexpected save'), create: () => assert.fail('Unexpected create'), refresh: async () => {}, notify: () => {} };
  let reads = 0;
  try {
    await act(async () => root.render(<SettingsDialog state={state} actions={actions} onClose={() => {}} />));
    assert.equal(host.querySelector('nav')!.textContent!.includes('Agent access'), false);
    window.qingdanDesktop = { getConnection: async () => ({}), openConnectionSettings: async () => ({}), getAgentAccess: async () => { reads++; return base; }, saveAgentAccess: async () => base };
    await act(async () => root.render(<SettingsDialog state={state} actions={actions} onClose={() => {}} />));
    const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('nav button')).find(button => button.textContent === 'Agent access')!;
    assert.ok(tab); assert.equal(reads, 0);
    await act(async () => tab.click());
    assert.equal(reads, 1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('Account invalidation removes token and blocks further grant updates', async () => {
  setLanguagePreference('en');
  let writes = 0;
  window.qingdanDesktop = { getConnection: async () => ({}), openConnectionSettings: async () => ({}), getAgentAccess: async () => ({ ...base, enabled: true, listIds: ['list-a'], tokenConfigured: true }), saveAgentAccess: async () => { writes++; return { ...base, enabled: true, token: 'synthetic-only' }; } };
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<AgentAccessSettingsPanel state={state} />));
    await act(async () => window.dispatchEvent(new window.Event('qingdan-account-changed')));
    assert.equal(host.querySelectorAll('button,input').length, 0);
    assert.ok(host.querySelector('[role="alert"]'));
    assert.equal(writes, 0);
  } finally { await act(async () => root.unmount()); }
});


test('A delayed grant result cannot reveal a token after an account switch', async () => {
  setLanguagePreference('en');
  let resolveGrant!: (value: any) => void;
  window.qingdanDesktop = {
    getConnection: async () => ({}), openConnectionSettings: async () => ({}),
    getAgentAccess: async (accountId: string) => ({ ...base, accountId, listIds: ['list-a'] }),
    saveAgentAccess: () => new Promise(resolve => { resolveGrant = resolve; }),
  };
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<AgentAccessSettingsPanel state={state} />));
    const review = Array.from(host.querySelectorAll<HTMLLabelElement>('label')).find(label => label.textContent!.startsWith('I have reviewed'))!.querySelector<HTMLInputElement>('input')!;
    await act(async () => review.click());
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent!.startsWith('Enable agent'))!.click());
    assert.ok(resolveGrant);
    const nextState = { ...state, user: { ...user, userId: 'different-synthetic-account' } };
    await act(async () => root.render(<AgentAccessSettingsPanel state={nextState} />));
    await act(async () => resolveGrant({ ...base, enabled: true, token: 'must-not-be-shown' }));
    assert.equal(host.querySelector('input[aria-label="New access token"]'), null);
    assert.ok(host.textContent!.includes('different-synthetic-account'));
    assert.equal(host.textContent!.includes('must-not-be-shown'), false);
  } finally { await act(async () => root.unmount()); }
});

test('Denied or uncertain grant results are generic and never echoed or retried', async () => {
  setLanguagePreference('en'); let writes = 0;
  window.qingdanDesktop = {
    getConnection: async () => ({}), openConnectionSettings: async () => ({}),
    getAgentAccess: async () => ({ ...base, listIds: ['list-a'] }),
    saveAgentAccess: async () => { writes++; throw new Error('untrusted secret diagnostic'); },
  };
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<AgentAccessSettingsPanel state={state} />));
    await act(async () => Array.from(host.querySelectorAll<HTMLLabelElement>('label')).find(label => label.textContent!.startsWith('I have reviewed'))!.querySelector<HTMLInputElement>('input')!.click());
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent!.startsWith('Enable agent'))!.click());
    assert.equal(writes, 1);
    assert.equal(host.textContent!.includes('untrusted secret diagnostic'), false);
    assert.ok(host.querySelector('[role="alert"]'));
    assert.equal(host.querySelectorAll('button,input').length, 0);
  } finally { await act(async () => root.unmount()); }
});

test('Protected descriptor configuration exposes a path, never a token or endpoint', async () => {
  setLanguagePreference('en');
  const descriptorPath = '/synthetic-private-profile/agent/exact-account.json';
  window.qingdanDesktop = {
    getConnection: async () => ({}), openConnectionSettings: async () => ({}),
    getAgentAccess: async () => ({ ...base, listIds: ['list-a'], descriptorPath }),
    saveAgentAccess: async () => ({ ...base, enabled: true, listIds: ['list-a'], tokenConfigured: true, descriptorPath, endpoint: 'http://127.0.0.1:32123/tools', mcpCommand: '/synthetic/Qingdan', mcpArgs: ['--mcp'] }),
  };
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<AgentAccessSettingsPanel state={state} />));
    assert.equal(host.querySelector('pre'), null, 'Reading settings must not imply a grant');
    await act(async () => Array.from(host.querySelectorAll<HTMLLabelElement>('label')).find(label => label.textContent!.startsWith('I have reviewed'))!.querySelector<HTMLInputElement>('input')!.click());
    await act(async () => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent!.startsWith('Enable agent'))!.click());
    assert.equal(host.querySelector<HTMLSelectElement>('select')!.value, 'generic');
    assert.deepEqual(JSON.parse(host.querySelector('pre')!.textContent!), { command: '/synthetic/Qingdan', args: ['--mcp'], env: { QINGDAN_AGENT_DESCRIPTOR: descriptorPath } });
    assert.ok(host.textContent!.includes('not a universal client configuration file'));
    await act(async () => { const select = host.querySelector<HTMLSelectElement>('select')!; select.value = 'codex'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.ok(host.querySelector('pre')!.textContent!.startsWith('[mcp_servers.qingdan]'));
    await act(async () => { const select = host.querySelector<HTMLSelectElement>('select')!; select.value = 'opencode'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
    const config = JSON.parse(host.querySelector('pre')!.textContent!);
    assert.deepEqual(config.mcp.qingdan.environment, { QINGDAN_AGENT_DESCRIPTOR: descriptorPath });
    assert.deepEqual(config.mcp.qingdan.command, ['/synthetic/Qingdan', '--mcp']);
    assert.equal(config.mcp.qingdan.type, 'local');
    assert.equal(config.mcp.qingdan.enabled, true);
    assert.equal(host.querySelector('pre')!.textContent!.includes('dist/server'), false);
    assert.equal(host.querySelector('input[aria-label="New access token"]'), null);
    assert.equal(host.querySelector('pre')!.textContent!.includes('QINGDAN_AGENT_TOKEN'), false);
  } finally { await act(async () => root.unmount()); }
});


test('Client snippets escape paths and keep Windows credentials as placeholders', () => {
  const settings = { ...base, enabled: true, mcpCommand: 'C:\\Program Files\\Qingdan\\Qingdan.exe', mcpArgs: ['--mcp'], endpoint: 'http://127.0.0.1:32123/tools' };
  const generic = JSON.parse(agentClientConfig(settings, 'generic'));
  assert.deepEqual(generic.args, ['--mcp']);
  assert.equal(generic.command, settings.mcpCommand);
  assert.equal(generic.env.ELECTRON_NO_ATTACH_CONSOLE, '1');
  assert.equal(generic.env.QINGDAN_AGENT_TOKEN, '<access-token>');
  assert.equal(generic.mcpServers, undefined);
  const codex = agentClientConfig(settings, 'codex');
  assert.ok(codex.startsWith('[mcp_servers.qingdan]'));
  assert.ok(codex.includes('[mcp_servers.qingdan.env]'));
  assert.equal(JSON.parse(codex.split('\n')[1].slice('command = '.length)), settings.mcpCommand);
  const openCode = JSON.parse(agentClientConfig(settings, 'opencode')).mcp.qingdan;
  assert.deepEqual(openCode.command, [settings.mcpCommand, '--mcp']);
  assert.equal(openCode.environment.QINGDAN_AGENT_TOKEN, '<access-token>');
  assert.equal(openCode.environment.QINGDAN_AGENT_ENDPOINT, settings.endpoint);
  assert.equal(openCode.environment.ELECTRON_NO_ATTACH_CONSOLE, '1');
  assert.ok(codex.includes('ELECTRON_NO_ATTACH_CONSOLE = "1"'));
  assert.equal(openCode.type, 'local');
});
