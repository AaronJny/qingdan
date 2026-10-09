import React from 'react';
import { RefreshCw } from 'lucide-react';

export type WorkspaceSyncState = {
  phase: 'idle' | 'syncing' | 'success' | 'offline' | 'error' | 'interrupted';
  message: string;
  lastSuccessAt?: string;
};

export default function WorkspaceSyncPanel({mode,state,onSync}:{mode?:string;state?:WorkspaceSyncState;onSync:()=>Promise<void>}) {
  const syncing=state?.phase==='syncing';
  const failed=state?.phase==='offline'||state?.phase==='error';
  return <section className="workspace-sync-panel" aria-label="数据同步" style={{padding:'16px 0',borderBottom:'1px solid var(--border)',marginBottom:16}}>
    <h3>数据同步</h3>
    <div className="button-row" style={{margin:'12px 0'}}>
      <button className="subtle-button" disabled={syncing} aria-busy={syncing} onClick={()=>{void onSync()}}><RefreshCw size={15}/>{syncing?'正在同步…':'立即同步'}</button>
    </div>
    <p className={failed?'inline-error':'form-help'} role={failed?'alert':'status'} aria-live="polite">{state?.message||'点击读取当前服务的最新数据。'}</p>
    <p className="form-help" data-last-sync={state?.lastSuccessAt||''}>{state?.lastSuccessAt?'上次成功同步：'+new Date(state.lastSuccessAt).toLocaleString('zh-CN'):'尚未在此窗口完成在线同步。'}</p>
    <p className="form-help">{mode==='local'?'本地模式只刷新当前本机服务。':'同步当前服务器中此账号的数据。'}待确认修改请在“查看与恢复”中核对。</p>
  </section>;
}
