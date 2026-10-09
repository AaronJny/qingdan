export type DesktopConnection = {
  mode: 'builtin' | 'server';
  serverUrl: string;
  status: 'connecting' | 'connected' | 'disconnected';
  serverMode: 'local' | 'accounts' | null;
};
export type DesktopBridge = {
  getConnection(): Promise<DesktopConnection>;
  openConnectionSettings(): Promise<{ ok: boolean }>;
};
declare global { interface Window { qingdanDesktop?: DesktopBridge } }
export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = window.qingdanDesktop;
  return bridge && typeof bridge.getConnection === 'function' && typeof bridge.openConnectionSettings === 'function' ? bridge : undefined;
}
