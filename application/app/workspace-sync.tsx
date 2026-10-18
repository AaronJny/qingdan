
import {t as tr, translateError, formatDate} from '../lib/i18n';
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
  return <section className="workspace-sync-panel" aria-label={tr("ui.secondary.workspaceSync.dataSync")} style={{padding:'16px 0',borderBottom:'1px solid var(--border)',marginBottom:16}}>
    <h3>{tr("ui.secondary.workspaceSync.dataSync")}</h3>
    <div className="button-row" style={{margin:'12px 0'}}>
      <button className="subtle-button" disabled={syncing} aria-busy={syncing} onClick={()=>{void onSync()}}><RefreshCw size={15}/>{syncing?tr("ui.secondary.workspaceSync.syncing"):tr("ui.secondary.workspaceSync.syncNow")}</button>
    </div>
    <p className={failed?'inline-error':'form-help'} role={failed?'alert':'status'} aria-live="polite">{translateError(state?.message||tr("ui.secondary.workspaceSync.fetchTheLatestDataFromTheCurrent"))}</p>
    <p className="form-help" data-last-sync={state?.lastSuccessAt||''}>{state?.lastSuccessAt?tr("ui.secondary.workspaceSync.lastSuccessfulSync",{v0:(formatDate(state.lastSuccessAt,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))??''}):tr("ui.secondary.workspaceSync.noOnlineSyncHasCompletedInThis")}</p>
    <p className="form-help">{tr("ui.secondary.workspaceSync.reviewPendingChangesInViewAndRecover",{v0:(mode==='local'?tr("ui.secondary.workspaceSync.localModeRefreshesOnlyTheCurrentLocal"):tr("ui.secondary.workspaceSync.syncThisAccountSDataFromThe"))??''})}</p>
  </section>;
}
