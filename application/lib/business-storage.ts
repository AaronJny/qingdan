/** Explicit business-data storage. Chromium storage is deliberately ephemeral in
 * the built-in desktop window; only this native bridge can acknowledge durability. */
export type StorageLike = Pick<Storage, 'length'|'key'|'getItem'|'setItem'|'removeItem'> & {keys?():string[]};
export type NativeBusinessStorage = {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
  keys():string[];
};
declare global { interface Window { qingdanLocalStorage?: NativeBusinessStorage } }

export function usesNativeBusinessStorage():boolean {
  return typeof window !== 'undefined' &&
    (window.qingdanDesktop?.localBusinessStorageRequired === true || window.qingdanLocalStorage !== undefined);
}

/** Never cache a fallback: a missing/broken required bridge must fail closed.
 * Reads are synchronous, so first-render drafts need no asynchronous hydration. */
export function businessStorage():StorageLike {
  if (usesNativeBusinessStorage()) {
    const owner=window;
    const nativeBridge=()=>{
      const bridge=owner.qingdanLocalStorage;
      if(!bridge||!['getItem','setItem','removeItem','keys'].every(method=>typeof bridge[method as keyof NativeBusinessStorage]==='function'))throw new Error('Local storage bridge unavailable.');
      return bridge;
    };
    const write=(key:string,operation:'set'|'remove',value:string|null)=>{
      try{
        if(isNativeInputKey(key)&&failures.has(owner))throw new Error(NATIVE_STORAGE_BLOCKED_MESSAGE);
        if(operation==='set')nativeBridge().setItem(key,value!);else nativeBridge().removeItem(key);
      }catch(error){if(isNativeInputKey(key))captureNativeFailure(owner,key,operation,value,error);throw error}
    };
    return {
      get length(){ return nativeBridge().keys().length; },
      key(index){ return nativeBridge().keys()[index] ?? null; },
      keys(){ return nativeBridge().keys(); },
      getItem(key){ return nativeBridge().getItem(key); },
      // The main process returns only after its atomic, fsynced write finishes.
      // Do not catch errors or acknowledge a browser/session-memory fallback.
      setItem(key,value){ write(key,'set',value); },
      removeItem(key){ write(key,'remove',null); },
    };
  }
  return typeof window === 'undefined' ? globalThis.localStorage : window.localStorage;
}

export function storageKeys(storage:StorageLike):string[] {
  if(storage.keys)return storage.keys();
  const keys:string[]=[];
  for(let index=0;index<storage.length;index++){const key=storage.key(index);if(key!==null)keys.push(key);}
  return keys;
}

/** These values are derived from confirmed data or are non-input preferences.
 * Their independent failure UX must not freeze task editing when another local
 * window legitimately refreshes them. All other native keys fail closed. */
export function isNativeInputKey(key:string){return key!=='qingdan-language'&&key!=='qingdan:offline-shell-session:v1'&&!['qingdan:offline:','qingdan:offline-shell-opt:','qingdan:view:'].some(prefix=>key.startsWith(prefix))}
export const NATIVE_STORAGE_FAILURE_EVENT='qingdan-native-storage-failed';
export const NATIVE_STORAGE_BLOCKED_MESSAGE='Local input could not be durably saved. Export unsaved input, then reload to reconcile before making more changes.';
export type NativeFailedWrite={key:string;operation:'set'|'remove';value:string|null;firstValue:string|null;firstReason:string;latestReason:string;firstFailedAt:string;latestFailedAt:string;attempts:number};
type NativeFailureState={version:number;firstReason:string;latestReason:string;writes:Map<string,NativeFailedWrite>};
const failures=new WeakMap<Window,NativeFailureState>();
function failureState(){return usesNativeBusinessStorage()?failures.get(window):undefined}
function failureReason(error:unknown){return error instanceof Error?error.message:String(error)}
export function nativeStorageFailureVersion(){return failureState()?.version??0}
export function nativeStorageWritesBlocked(){return !!failureState()}
export function subscribeNativeStorageFailure(listener:()=>void){if(typeof window==='undefined')return()=>{};const owner=window;owner.addEventListener(NATIVE_STORAGE_FAILURE_EVENT,listener);return()=>owner.removeEventListener(NATIVE_STORAGE_FAILURE_EVENT,listener)}
function captureNativeFailure(owner:Window,key:string,operation:'set'|'remove',value:string|null,error:unknown){
 const reason=failureReason(error),now=new Date().toISOString();let state=failures.get(owner);
 if(!state){state={version:0,firstReason:reason,latestReason:reason,writes:new Map()};failures.set(owner,state);
  // Exporting is not proof that the user saved a file. Keep this guard until a
  // real reload, and never silently clear it after an in-flight write response.
  owner.addEventListener('beforeunload',event=>{if(failures.get(owner)?.writes.size){event.preventDefault();try{event.returnValue=''}catch{}}});
 }
 const id=operation+':'+key,previous=state.writes.get(id);
 state.writes.set(id,{key,operation,value,firstValue:previous?previous.firstValue:value,firstReason:previous?.firstReason??reason,latestReason:reason,firstFailedAt:previous?.firstFailedAt??now,latestFailedAt:now,attempts:(previous?.attempts??0)+1});
 state.latestReason=reason;state.version++;owner.dispatchEvent(new Event(NATIVE_STORAGE_FAILURE_EVENT));
}
export function assertNativeMutationAllowed(){if(nativeStorageWritesBlocked())throw Object.assign(new Error(NATIVE_STORAGE_BLOCKED_MESSAGE),{code:'NATIVE_STORAGE_UNCONFIRMED'})}
/** Explicit reconciliation evidence. This must never be replayed as a backup:
 * a failed removal can follow a backend commit that already succeeded. */
export function exportNativeUnsavedInput(){
 const state=failureState();
 const durableBusinessEntries:{key:string;value:string}[]=[],readErrors:{key?:string;reason:string}[]=[];
 if(usesNativeBusinessStorage())try{const storage=businessStorage();for(const key of storageKeys(storage)){
  // Snapshots are available in ordinary backup; this export prioritizes input,
  // operation identities and preferences without duplicating a large cache.
  if(key.startsWith('qingdan:offline:')||key==='qingdan:offline-shell-session:v1')continue;
  try{const value=storage.getItem(key);if(value!==null)durableBusinessEntries.push({key,value})}catch(error){readErrors.push({key,reason:failureReason(error)})}
 }}catch(error){readErrors.push({reason:failureReason(error)})}
 return{format:'qingdan-native-unsaved-input',version:1,exportedAt:new Date().toISOString(),requiresReconciliation:true,instructions:'Review these inputs against saved tasks after reload. Do not automatically import or replay them: an in-flight backend change may already have succeeded.',firstReason:state?.firstReason??null,latestReason:state?.latestReason??null,failedWrites:state?[...state.writes.values()].map(entry=>({...entry})):[],durableBusinessEntries,readErrors};
}
