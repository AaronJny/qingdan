'use client';
import React, { useEffect, useRef, useState } from 'react';
import { t as tr } from '../lib/i18n';
import { desktopBridge, type AgentAccessSettings } from '../lib/desktop-connection';
import { displayRecordTitle } from '../lib/i18n-records';
import type { Bootstrap } from '../lib/types';

export function agentClientConfig(settings: AgentAccessSettings, client: 'generic' | 'codex' | 'opencode'): string {
  const command = settings.mcpCommand || 'node';
  const args = settings.mcpCommand ? settings.mcpArgs || ['--mcp'] : ['/absolute/path/to/qingdan/application/dist/server/mcp.mjs'];
  const env: Record<string, string> = settings.descriptorPath ? { QINGDAN_AGENT_DESCRIPTOR: settings.descriptorPath } : { QINGDAN_AGENT_ENDPOINT: settings.endpoint || '<endpoint-from-settings>', QINGDAN_AGENT_TOKEN: '<access-token>' };
  // Keep Electron's Windows GUI launcher attached to the MCP client's pipes,
  // rather than replacing them with the parent's interactive console.
  if (settings.mcpCommand && /\.exe$/i.test(settings.mcpCommand)) env.ELECTRON_NO_ATTACH_CONSOLE = '1';
  if (client === 'generic') return JSON.stringify({ command, args, env }, null, 2);
  if (client === 'opencode') return JSON.stringify({ mcp: { qingdan: { type: 'local', command: [command, ...args], environment: env, enabled: true } } }, null, 2);
  return ['[mcp_servers.qingdan]', 'command = ' + JSON.stringify(command), 'args = ' + JSON.stringify(args), '', '[mcp_servers.qingdan.env]', ...Object.entries(env).map(([key, value]) => key + ' = ' + JSON.stringify(value))].join('\n');
}

/** This panel never persists a token or performs a grant without an explicit click. */
export default function AgentAccessSettingsPanel({ state }: { state: Bootstrap }) {
  const bridge = desktopBridge();
  const accountId = state.user.userId;
  const [settings, setSettings] = useState<AgentAccessSettings | null>(null);
  const [listIds, setListIds] = useState<string[]>([]);
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [token, setToken] = useState('');
  const [client, setClient] = useState<'generic' | 'codex' | 'opencode'>('generic');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(false);
  const pending = useRef(false);
  const epoch = useRef(0);
  const lists = state.records.filter(record => record.kind === 'list' && !record.deleted && record.data.listType !== 'note');
  const availableIds = new Set(lists.map(list => list.id));
  const selected = listIds.filter(id => availableIds.has(id));
  useEffect(() => {
    alive.current = true;
    epoch.current++;
    let live = true;
    setSettings(null); setToken(''); setError(''); setMessage(''); setReviewed(false); setBusy(false);
    const invalidate = () => { live = false; alive.current = false; epoch.current++; setToken(''); setSettings(null); setError(tr('agentAccess.unavailable')); };
    window.addEventListener('qingdan-account-changed', invalidate);
    void bridge?.getAgentAccess?.(accountId).then(value => {
      if (!live) return;
      if (value.accountId !== accountId) { invalidate(); return; }
      setSettings(value); setListIds(value.listIds); setWriteEnabled(value.writeEnabled);
    }).catch(() => { if (live) setError(tr('agentAccess.unavailable')); });
    return () => { live = false; alive.current = false; epoch.current++; window.removeEventListener('qingdan-account-changed', invalidate); };
  }, [accountId, bridge]);
  const change = () => { setReviewed(false); setMessage(''); };
  const save = async (enable: boolean) => {
    if (!settings || !bridge?.saveAgentAccess || pending.current || !alive.current) return;
    if (enable && (!reviewed || selected.length === 0)) return;
    const operationEpoch = epoch.current;
    pending.current = true; setBusy(true); setError(''); setMessage(''); setToken('');
    try {
      const result = await bridge.saveAgentAccess(accountId, enable
        ? { enabled: true, writeEnabled, listIds: selected, rotateToken: true }
        : { enabled: false, writeEnabled: false, listIds: [] });
      if (!alive.current || operationEpoch !== epoch.current) return;
      if (result.accountId !== accountId) throw new Error('Account mismatch');
      // Keep the one-time secret out of the general settings object.
      const { token: newToken, ...confirmed } = result;
      setSettings(confirmed); setListIds(confirmed.listIds); setWriteEnabled(confirmed.writeEnabled);
      setToken(confirmed.descriptorPath ? '' : newToken || ''); setReviewed(false);
      setMessage(tr(enable ? 'agentAccess.saved' : 'agentAccess.revoked'));
    } catch {
      if (alive.current && operationEpoch === epoch.current) { setError(tr('agentAccess.failed')); setSettings(null); }
    } finally { pending.current = false; if (alive.current && operationEpoch === epoch.current) setBusy(false); }
  };
  const copyToken = async () => {
    try { await navigator.clipboard.writeText(token); if (alive.current) setMessage(tr('agentAccess.copied')); }
    catch { if (alive.current) setMessage(tr('agentAccess.copyFailed')); }
  };
  if (!bridge?.getAgentAccess || !bridge.saveAgentAccess) return null;
  return <section className="agent-access-panel" aria-label={tr('agentAccess.title')}>
    <h3>{tr('agentAccess.title')}</h3>
    <p>{tr('agentAccess.intro')}</p>
    <p className="form-help">{tr('agentAccess.requirements')}</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!settings && !error && <p role="status">{tr('agentAccess.loading')}</p>}
    {settings && <>
      <h4>{tr('agentAccess.target')}</h4>
      <p className="connection-address">{settings.serverUrl}<br />{state.user.displayName} ({settings.accountId})</p>
      <p role="status">{tr(settings.enabled ? 'agentAccess.active' : 'agentAccess.inactive')}</p>
      <p className="form-help">{tr('agentAccess.readScope')}</p>
      <fieldset disabled={busy}>
        <legend>{tr('agentAccess.scope')}</legend>
        <p className="form-help">{tr('agentAccess.scopeHelp')}</p>
        {lists.length === 0 && <p>{tr('agentAccess.empty')}</p>}
        {lists.map(list => <label key={list.id}><input type="checkbox" checked={selected.includes(list.id)} onChange={event => {
          change(); setListIds(event.target.checked ? [...selected, list.id] : selected.filter(id => id !== list.id));
        }} />{displayRecordTitle(list)}</label>)}
        <label><input type="checkbox" checked={writeEnabled} onChange={event => { change(); setWriteEnabled(event.target.checked); }} />{tr('agentAccess.write')}</label>
        <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />{tr('agentAccess.review')}</label>
      </fieldset>
      <p className="form-help">{tr('agentAccess.rotateHelp')}</p>
      <div className="button-row">
        <button type="button" className="primary" disabled={busy || !reviewed || selected.length === 0} onClick={() => void save(true)}>{tr(settings.enabled ? 'agentAccess.generate' : 'agentAccess.enable')}</button>
        <button type="button" className="subtle-button danger" disabled={busy || !settings.enabled} onClick={() => void save(false)}>{tr('agentAccess.revoke')}</button>
      </div>
      {token && <div className="agent-token">
        <label>{tr('agentAccess.token')}<input aria-label={tr('agentAccess.token')} type="text" value={token} readOnly autoComplete="off" spellCheck={false} /></label>
        <p className="form-help">{tr('agentAccess.tokenHelp')}</p>
        <div className="button-row"><button type="button" onClick={() => void copyToken()}>{tr('agentAccess.copy')}</button><button type="button" onClick={() => setToken('')}>{tr('agentAccess.clear')}</button></div>
      </div>}
      {settings.enabled && (settings.descriptorPath || settings.endpoint) && <>
        <h4>{tr('agentAccess.configuration')}</h4>
        <p className="form-help">{tr(settings.mcpCommand ? 'agentAccess.packagedConfigHelp' : 'agentAccess.configHelp')}</p>
        <p className="form-help">{tr(settings.descriptorPath ? 'agentAccess.descriptorHelp' : 'agentAccess.tokenConfigHelp')}</p>
        <label>{tr('agentAccess.client')}<select aria-label={tr('agentAccess.client')} value={client} onChange={event => setClient(event.target.value as 'generic' | 'codex' | 'opencode')}><option value="generic">{tr('agentAccess.generic')}</option><option value="codex">Codex · {tr('agentAccess.templateOnly')}</option><option value="opencode">OpenCode · {tr('agentAccess.templateOnly')}</option></select></label>
        <p className="form-help">{tr(client === 'generic' ? 'agentAccess.genericHelp' : client === 'codex' ? 'agentAccess.codexHelp' : 'agentAccess.opencodeHelp')}</p>
        <pre className="agent-config">{agentClientConfig(settings, client)}</pre>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(agentClientConfig(settings, client)); if (alive.current) setMessage(tr('agentAccess.configCopied')); }
          catch { if (alive.current) setMessage(tr('agentAccess.configCopyFailed')); }
        }}>{tr('agentAccess.copyConfig')}</button>
      </>}
    </>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>;
}
