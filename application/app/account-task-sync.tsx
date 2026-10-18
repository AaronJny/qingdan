
import {t as tr, translateError, formatNumber} from '../lib/i18n';
import React,{useState}from'react';
import type{AppRecord}from'../lib/types';
import type{TaskOperation}from'../lib/account-task-queue';
export default function AccountTaskSync({entries,error,records,onRetry,onResolve,onDiscard,onExport}:{entries:TaskOperation[];error?:string;records:AppRecord[];onRetry:()=>void;onResolve:(op:TaskOperation,record:AppRecord)=>void;onDiscard:(recordId:string)=>void;onExport:()=>void}){
 const[expanded,setExpanded]=useState(false);const conflicts=entries.filter(op=>op.status==='conflict');
 if(!entries.length)return null;
 return <section className="pending-banner account-task-sync" aria-label={tr("ui.secondary.accountTaskSync.offlineTaskSync")}>
  <div role="status">{tr("ui.secondary.accountTaskSync.savedOnThisDevicePendingTaskOperations",{count:Number(entries.length),v0:formatNumber(Number(entries.length)),v1:(conflicts.length?tr("ui.secondary.accountTaskSync.includingRequiringReview",{v0:conflicts.length}):'')??''})}</div>
  {error&&<p role="alert">{translateError(error)}</p>}
  <p>{tr("ui.secondary.accountTaskSync.supportsCreatingEditingCompletingDeletingAndRestoring")}</p>
  <button onClick={onRetry}>{tr("ui.secondary.accountTaskSync.retryNow")}</button><button onClick={()=>setExpanded(!expanded)}>{expanded?tr("ui.secondary.accountTaskSync.collapse"):tr("ui.secondary.accountTaskSync.viewPendingChangesAndConflicts")}</button><button onClick={onExport}>{tr("ui.secondary.accountTaskSync.exportPendingInput")}</button>
  {expanded&&entries.map(op=>{const remote=records.find(record=>record.id===op.recordId);return <div className="task-sync-entry" key={op.id}>
   <strong>{op.desired.title||op.base.data.title||tr("ui.secondary.accountTaskSync.task")} · {({create:tr("ui.secondary.accountTaskSync.create"),edit:tr("ui.secondary.accountTaskSync.edit"),complete:tr("ui.secondary.accountTaskSync.complete"),undoComplete:tr("ui.secondary.accountTaskSync.undoCompletion"),trash:op.deleted?tr("ui.secondary.accountTaskSync.moveToTrash"):tr("ui.secondary.accountTaskSync.restore")})[op.action]}</strong>
   <p>{op.status==='conflict'?translateError(op.reason||''):tr("ui.secondary.accountTaskSync.waitingForTheConnectionAndServerConfirmation")}</p>
   {op.status==='conflict'&&<><details><summary>{tr("ui.secondary.accountTaskSync.compareLocalInputAndServerVersion")}</summary><label>{tr("ui.secondary.accountTaskSync.localInput")}<textarea readOnly rows={6} value={JSON.stringify(op.desired,null,2)}/></label><label>{tr("ui.secondary.accountTaskSync.currentServerVersion")}<textarea readOnly rows={6} value={remote?JSON.stringify(remote.data,null,2):tr("ui.secondary.accountTaskSync.currentlyUnavailableSignInAgainOrContact")}/></label></details>
   {remote&&<button onClick={()=>{if(confirm(tr("ui.secondary.accountTaskSync.haveYouReviewedBothVersionsContinuingWill")))onResolve(op,remote)}}>{tr("ui.secondary.accountTaskSync.retryWithMyChanges")}</button>}
   <button onClick={()=>{if(confirm(tr("ui.secondary.accountTaskSync.discardAllPendingOperationsForThisTask")))onDiscard(op.recordId)}}>{remote?tr("ui.secondary.accountTaskSync.keepServerVersion"):tr("ui.secondary.accountTaskSync.discardThisTaskSPendingLocalOperations")}</button></>}
  </div>})}
 </section>
}
