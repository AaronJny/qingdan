export type DesktopConnection = {
  mode: 'builtin' | 'server';
  serverUrl: string;
  status: 'connecting' | 'connected' | 'disconnected';
  serverMode: 'local' | 'accounts' | null;
};
export type LocalRecoveryStatus = {status:'none'|'pending';requiresReview:boolean;acknowledgedContinue:boolean;candidateCount:number;conflictCount:number};
export type DesktopBridge = {
  /** True only for the trusted built-in local window, before application startup. */
  localBusinessStorageRequired?: boolean;
  getLocalRecovery?(): Promise<LocalRecoveryStatus>;
  openLocalRecovery?(): Promise<{ok:true}>;
  getConnection(): Promise<DesktopConnection>;
  openConnectionSettings(): Promise<{ ok: boolean }>;
};
declare global { interface Window { qingdanDesktop?: DesktopBridge } }
export function desktopBridge(): DesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = window.qingdanDesktop;
  return bridge && typeof bridge.getConnection === 'function' && typeof bridge.openConnectionSettings === 'function' ? bridge : undefined;
}
