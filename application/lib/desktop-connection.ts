export type AgentAccessSettings = {
  enabled: boolean;
  writeEnabled: boolean;
  listIds: string[];
  tokenConfigured: boolean;
  serverUrl: string;
  accountId: string;
  endpoint: string | null;
  descriptorPath: string | null;
  mcpCommand?: string | null;
  mcpArgs?: string[];
  sessionOnly: true;
};
export type AgentAccessUpdate = { enabled: boolean; writeEnabled: boolean; listIds: string[]; rotateToken?: boolean };
export type DesktopConnection = {
  mode: 'builtin' | 'server';
  serverUrl: string;
  status: 'connecting' | 'connected' | 'disconnected';
  serverMode: 'local' | 'accounts' | null;
};
export type DesktopBridge = {
  /** True only for the trusted built-in local window, before application startup. */
  localBusinessStorageRequired?: boolean;
  getConnection(): Promise<DesktopConnection>;
  getAgentAccess?(accountId: string): Promise<AgentAccessSettings>;
  saveAgentAccess?(accountId: string, settings: AgentAccessUpdate): Promise<AgentAccessSettings & { token?: string }>;
  openConnectionSettings(): Promise<{ ok: boolean }>;
};
declare global { interface Window { qingdanDesktop?: DesktopBridge } }
export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = window.qingdanDesktop;
  return bridge && typeof bridge.getConnection === 'function' && typeof bridge.openConnectionSettings === 'function' ? bridge : undefined;
}
