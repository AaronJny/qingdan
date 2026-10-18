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
const summary=document.getElementById('summary'),message=document.getElementById('message');
let nextOffset=null,summaryState=null,messageKey=null,candidateRows=[],emptyCandidates=false;
let languageRevision=Number(document.documentElement?.dataset?.languageRevision)||0;
function report(){messageKey='error';message.textContent=tr(messageKey);}
function renderSummary(){if(!summaryState)return;const value=summaryState;summary.textContent=tr(value.status==='none'?'none':value.requiresReview?'pending':'preferences');document.getElementById('diagnostics').textContent=value.conflictCount?tr('conflicts'):'';}
function renderCandidates(){
  for(const {heading,body,item,index}of candidateRows){
    const amount=new Intl.NumberFormat(document.documentElement?.lang||'en').format(index);
    heading.textContent=tr('candidate')+' '+amount+' · '+kindLabel(item.kind);
    body.setAttribute('aria-label',heading.textContent);
    // Never rewrite readable evidence; only app-owned unavailable labels change.
    if(typeof item.value!=='string')body.value=tr('unreadable');
  }
  if(emptyCandidates)document.getElementById('candidates').textContent=tr('no.candidates');
}
function applyLanguage(value){
  if(!value||!['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR'].includes(value.locale)||!Number.isSafeInteger(value.revision)||value.revision<languageRevision)return;
  languageRevision=value.revision;void window.i18next.changeLanguage(value.locale);document.documentElement.lang=value.locale;document.title=tr('title');
  for(const element of document.querySelectorAll('[data-recovery-text]'))element.textContent=tr(element.dataset.recoveryText);
  document.getElementById('candidates').setAttribute('aria-label',tr('candidates'));
  renderSummary();renderCandidates();if(messageKey)message.textContent=tr(messageKey);
}
window.qingdanRecovery.onLanguageChanged?.(applyLanguage);
async function refresh(){try{summaryState=await window.qingdanRecovery.summary();renderSummary();for(const id of ['view','export','continue'])document.getElementById(id).disabled=!!summaryState.unavailable;}catch(error){report();document.getElementById('continue').disabled=true;}}
async function viewPage(offset){try{
  const page=await window.qingdanRecovery.candidates(offset),host=document.getElementById('candidates');host.replaceChildren();host.hidden=false;candidateRows=[];emptyCandidates=!page.items.length;
  for(const [index,item]of page.items.entries()){
    const details=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('textarea');body.readOnly=true;body.rows=8;body.style.width='100%';body.value=typeof item.value==='string'?item.value:tr('unreadable');details.append(heading,body);host.append(details);candidateRows.push({heading,body,item,index:offset+index+1});
  }
  renderCandidates();nextOffset=page.nextOffset;document.getElementById('more').hidden=nextOffset===null;
}catch(error){report();}}
document.getElementById('view').addEventListener('click',()=>void viewPage(0));
document.getElementById('more').addEventListener('click',()=>{if(nextOffset!==null)void viewPage(nextOffset);});
document.getElementById('export').addEventListener('click',async()=>{try{const result=await window.qingdanRecovery.export();if(result.saved){messageKey='exported';message.textContent=tr(messageKey);}}catch(error){report();}});
document.getElementById('continue').addEventListener('click',async()=>{try{document.getElementById('continue').disabled=true;await window.qingdanRecovery.continue();}catch(error){report();document.getElementById('continue').disabled=false;}});
void refresh();
