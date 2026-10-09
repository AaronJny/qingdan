import type{RecordData}from'./types';
/** Completing a root changes only execution state. Undo must not roll back
 * later title/body, scheduling, list or parent edits from the old snapshot. */
export function undoTaskData(current:RecordData,before?:RecordData):RecordData{return{...current,status:before?.status||'open',completedAt:before?.completedAt||'',completionMutation:before?.completionMutation||'',completionParent:before?.completionParent||''}}
