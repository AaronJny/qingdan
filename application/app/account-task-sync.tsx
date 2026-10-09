import React,{useState}from'react';
import type{AppRecord}from'../lib/types';
import type{TaskOperation}from'../lib/account-task-queue';
export default function AccountTaskSync({entries,error,records,onRetry,onResolve,onDiscard,onExport}:{entries:TaskOperation[];error?:string;records:AppRecord[];onRetry:()=>void;onResolve:(op:TaskOperation,record:AppRecord)=>void;onDiscard:(recordId:string)=>void;onExport:()=>void}){
 const[expanded,setExpanded]=useState(false);const conflicts=entries.filter(op=>op.status==='conflict');
 if(!entries.length)return null;
 return <section className="pending-banner account-task-sync" aria-label="任务离线同步">
  <div role="status">已在此设备保存 {entries.length} 条待同步任务操作{conflicts.length?`，其中 ${conflicts.length} 条需要核对`:''}。打开应用且连接恢复后，会在当前服务器和账号下自动重试。</div>
  {error&&<p role="alert">{error}</p>}
  <p>支持任务新增、编辑、完成及回收/恢复。重复任务的下一次实例在服务器确认后生成。附件、共享、账号管理与其他写入仍需联网处理。</p>
  <button onClick={onRetry}>立即重试</button><button onClick={()=>setExpanded(!expanded)}>{expanded?'收起':'查看待同步与冲突'}</button><button onClick={onExport}>导出待同步输入</button>
  {expanded&&entries.map(op=>{const remote=records.find(record=>record.id===op.recordId);return <div className="task-sync-entry" key={op.id}>
   <strong>{op.desired.title||op.base.data.title||'任务'} · {({create:'新增',edit:'编辑',complete:'完成',undoComplete:'撤销完成',trash:op.deleted?'移入回收站':'恢复'})[op.action]}</strong>
   <p>{op.status==='conflict'?op.reason:'等待连接及服务器确认；原操作标识保持不变。'}</p>
   {op.status==='conflict'&&<><details><summary>比较本机输入和服务器版本</summary><label>本机输入<textarea readOnly rows={6} value={JSON.stringify(op.desired,null,2)}/></label><label>服务器当前版本<textarea readOnly rows={6} value={remote?JSON.stringify(remote.data,null,2):'当前不可访问，请重新登录或联系清单所有者。'}/></label></details>
   {remote&&<button onClick={()=>{if(confirm('已查看两份内容？继续会以你的修改处理当前服务器版本；之后若再出现新冲突仍会暂停。'))onResolve(op,remote)}}>以我的修改重新尝试</button>}
   <button onClick={()=>{if(confirm('放弃这条任务在此设备上的全部待同步操作，使用当前服务器版本？可先导出保存输入。'))onDiscard(op.recordId)}}>{remote?'保留服务器版本':'放弃此任务的本机待同步操作'}</button></>}
  </div>})}
 </section>
}
