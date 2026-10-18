import {businessStorage,storageKeys,usesNativeBusinessStorage} from './business-storage';
// Unconfirmed input only, never a replacement for authoritative cloud records.
// Account IDs are part of every caller key. Persistent drafts survive reopening.
const memory=new Map<string,string|null>();
let volatile=false;
export function draftStorageVolatile(){return volatile}
export function warnVolatile(){volatile=true;if(typeof window!=='undefined')window.dispatchEvent(new Event('qingdan-draft-volatile'));}
function allDraftKeys(){const keys=new Set(memory.keys());try{for(const key of storageKeys(businessStorage()))keys.add(key);if(!usesNativeBusinessStorage())for(const key of storageKeys(sessionStorage))keys.add(key)}catch{warnVolatile()}return keys}
export function isAccountDraftKey(key:string,accountId:string){const encoded=encodeURIComponent(accountId);if(key==='qingdan:offline-shell-opt:'+encoded)return false;if(key==='qingdan:reminder-actions:'+encoded||key==='qingdan:full-backup-pending:'+encoded||key==='qingdan:habit-group-rename:'+encoded||key.startsWith('qingdan:comment-mentions:'+encoded+':')||key.startsWith('qingdan:background-upload:'+encoded+':')||key.startsWith('qingdan:attachment-upload:'+encoded+':')||key.startsWith('qingdan:list-transfer:'+encoded+':'))return true;if(key.startsWith('qingdan:form-draft:'+encoded+':'))return true;if(['create','write'].some(kind=>key.startsWith('qingdan:queue:'+kind+':'+encoded+':')))return true;const exact=['quick-draft','batch-tag-draft','pending-create','pending-write','pending-import','matrix-draft','calendar-batch'].some(kind=>key==='qingdan:'+kind+':'+accountId);const prefixed=['draft','check-draft','subtask-draft','comment-draft','focus-note','pending-template'].some(kind=>key.startsWith('qingdan:'+kind+':'+accountId+':'));const controlledLocalId=/^local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId);return (!accountId.includes(':')||controlledLocalId)&&(exact||prefixed)}
export const draftStore={
 getItem(key:string){if(memory.has(key))return memory.get(key)??null;try{const value=businessStorage().getItem(key);return usesNativeBusinessStorage()?value:value??sessionStorage.getItem(key)??null}catch{warnVolatile();return null}},
 setItem(key:string,value:string){memory.set(key,value);try{businessStorage().setItem(key,value);if(usesNativeBusinessStorage())memory.delete(key);else sessionStorage.removeItem(key);return true}catch{if(!usesNativeBusinessStorage())try{sessionStorage.setItem(key,value)}catch{}warnVolatile();return false}},
 removeItem(key:string){memory.set(key,null);try{businessStorage().removeItem(key);if(usesNativeBusinessStorage())memory.delete(key);else sessionStorage.removeItem(key);return true}catch{warnVolatile();return false}},
 keys(prefix:string){return[...allDraftKeys()].filter(key=>key.startsWith(prefix)&&this.getItem(key)!==null)},
 clearAccount(accountId:string){for(const key of allDraftKeys())if(isAccountDraftKey(key,accountId))this.removeItem(key)}
};
