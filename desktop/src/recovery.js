'use strict';
const tr=key=>window.qingdanT('desktop.recovery.'+key);
// Show only translated business categories; storage keys, principals and hashes
// belong to the review evidence, not the candidate navigation labels.
const kindLabels=Object.freeze({
  language:'language',
  'quick-draft':'quick.draft','desktop-quick-draft':'quick.draft',
  'batch-tag-draft':'tags.draft',
  'queue-create':'pending.create','pending-create':'pending.create',
  'queue-write':'pending.write','pending-write':'pending.write',
  'pending-import':'pending.import','pending-template':'pending.template',
  'matrix-draft':'matrix.draft','calendar-batch':'calendar.batch',
  draft:'task.draft','check-draft':'checklist.draft','subtask-draft':'subtask.draft',
  'comment-draft':'comment.draft','focus-note':'focus.note',view:'view',
  'full-backup-pending':'pending.backup','habit-group-rename':'habit.groups',
  'reminder-actions':'reminder.actions','offline-shell-opt':'offline.preference',
  offline:'offline.copy','offline-shell-session':'offline.session',
  'comment-mentions':'comment.mentions','background-upload':'background.upload',
  'attachment-upload':'attachment.upload','list-transfer':'list.transfer',
  'form-draft':'form.draft',
});
function kindLabel(kind){return tr('kind.'+(Object.hasOwn(kindLabels,kind)?kindLabels[kind]:'other'));}
const summary=document.getElementById('summary'),message=document.getElementById('message');let nextOffset=null;
function report(error){message.textContent=tr('error');}
async function refresh(){try{const value=await window.qingdanRecovery.summary();summary.textContent=value.status==='none'?tr('none'):value.requiresReview?tr('pending'):tr('preferences');document.getElementById('diagnostics').textContent=value.conflictCount?tr('conflicts'):'';for(const id of ['view','export','continue'])document.getElementById(id).disabled=!!value.unavailable;}catch(error){report(error);document.getElementById('continue').disabled=true;}}
async function viewPage(offset){try{const page=await window.qingdanRecovery.candidates(offset);const values=page.items;const host=document.getElementById('candidates');host.replaceChildren();host.hidden=false;for(const [index,item] of values.entries()){const details=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('textarea');heading.textContent=tr('candidate')+' '+(offset+index+1)+' · '+kindLabel(item.kind);body.readOnly=true;body.rows=8;body.style.width='100%';body.setAttribute('aria-label',heading.textContent);body.value=typeof item.value==='string'?item.value:tr('unreadable');details.append(heading,body);host.append(details);}if(!values.length)host.textContent=tr('no.candidates');nextOffset=page.nextOffset;document.getElementById('more').hidden=nextOffset===null;}catch(error){report(error);}}
document.getElementById('view').addEventListener('click',()=>void viewPage(0));
document.getElementById('more').addEventListener('click',()=>{if(nextOffset!==null)void viewPage(nextOffset);});
document.getElementById('export').addEventListener('click',async()=>{try{const result=await window.qingdanRecovery.export();if(result.saved)message.textContent=tr('exported');}catch(error){report(error);}});
document.getElementById('continue').addEventListener('click',async()=>{try{document.getElementById('continue').disabled=true;await window.qingdanRecovery.continue();}catch(error){report(error);document.getElementById('continue').disabled=false;}});
void refresh();
