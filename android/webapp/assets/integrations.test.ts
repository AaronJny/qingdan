/** Mock-only tests. No external providers, real credentials, audio or personal data.
 * Run: node --experimental-strip-types --test assets/integrations.test.ts */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIAdapter,createGoogleCalendarAdapter,IntegrationError} from './integrations.ts';
import type {FetchLike,GoogleEventInput,IntegrationErrorCode} from './integrations.ts';
const mockCredential='mock-only-not-a-valid-provider-credential';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function mock(responses:Response[]){const calls:{url:string;init:RequestInit}[]=[];const fetch:FetchLike=async(url,init={})=>{calls.push({url,init});const response=responses.shift();if(!response)throw new Error('Mock exhausted');return response;};return {fetch,calls};}
const hasCode=(code:IntegrationErrorCode)=>(e:unknown)=>e instanceof IntegrationError&&e.code===code;
const aiResponse=(text:string)=>({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text}]}]});
const aiOptions={token:mockCredential,model:'mock-model',transcriptionModel:'mock-transcription-model'};
const event:GoogleEventInput={summary:'Mock event',description:'Synthetic test data',start:{date:'2026-10-07'},end:{date:'2026-10-08'}};
const providerEvent={id:'mockid',etag:'"mock-etag"',status:'confirmed',...event};
test('missing credentials fail closed without touching fetch',()=>{
  let called=false;const fetch:FetchLike=async()=>{called=true;throw Error();};
  assert.throws(()=>createOpenAIAdapter({model:'mock',fetch}),hasCode('NOT_CONFIGURED'));
  assert.throws(()=>createGoogleCalendarAdapter({fetch}),hasCode('NOT_CONFIGURED'));assert.equal(called,false);
  assert.throws(()=>createGoogleCalendarAdapter({token:'mock\r\ninjection',fetch}),hasCode('INVALID_INPUT'));
});
test('browser execution is blocked even with supplied token',()=>{
  Object.defineProperty(globalThis,'window',{value:{},configurable:true});
  try{assert.throws(()=>createGoogleCalendarAdapter({token:mockCredential}),hasCode('SERVER_ONLY'));}finally{Reflect.deleteProperty(globalThis,'window');}
});
test('OpenAI summary uses Responses HTTP output parts; no arbitrary task metadata sent',async()=>{
  const m=mock([json(aiResponse('概述'))]);const ai=createOpenAIAdapter({...aiOptions,fetch:m.fetch});
  assert.equal(await ai.summarizeTasks([{title:'Synthetic task',description:'Synthetic description',priority:3,dueDate:'2026-10-07',hidden:'do not transmit'} as never]),'概述');
  const call=m.calls[0];assert.equal(call.url,'https://api.openai.com/v1/responses');assert.equal(call.init.method,'POST');assert.equal(new Headers(call.init.headers).get('Authorization'),`Bearer ${mockCredential}`);
  const body=JSON.parse(String(call.init.body));assert.equal(body.store,false);assert.equal(body.model,'mock-model');assert.equal(JSON.stringify(body).includes('do not transmit'),false);assert.equal(body.input[0].role,'user');assert.equal(call.init.redirect,'error');
});
test('OpenAI extraction uses strict JSON schema and validates dates/priorities/tags',async()=>{
  const output={tasks:[{title:'Synthetic task',description:'',dueDate:'2026-10-08',dueTime:'09:30',priority:2,tags:['mock']}],warnings:['Synthetic warning']};
  const m=mock([json(aiResponse(JSON.stringify(output)))]);const ai=createOpenAIAdapter({...aiOptions,fetch:m.fetch});
  assert.deepEqual(await ai.extractTasks('Synthetic source',{today:'2026-10-07',timeZone:'Asia/Shanghai'}),output);
  const format=JSON.parse(String(m.calls[0].init.body)).text.format;assert.equal(format.type,'json_schema');assert.equal(format.strict,true);assert.equal(format.schema.additionalProperties,false);
});
test('AI extraction rejects invalid JSON, extra fields, impossible date and time without date',async()=>{
  const good={title:'Synthetic task',description:'',dueDate:null,dueTime:null,priority:0,tags:[]};
  for(const value of ['not json',JSON.stringify({tasks:[{...good,dueDate:'2025-02-29'}],warnings:[]}),JSON.stringify({tasks:[{...good,dueTime:'09:00'}],warnings:[]}),JSON.stringify({tasks:[{...good,priority:4}],warnings:[]}),JSON.stringify({tasks:[{...good,hidden:'extra'}],warnings:[]}),JSON.stringify({tasks:[],warnings:[],extra:true})]){
    const m=mock([json(aiResponse(value))]);await assert.rejects(createOpenAIAdapter({...aiOptions,fetch:m.fetch}).extractTasks('Synthetic',{today:'2026-10-07',timeZone:'UTC'}),hasCode('INVALID_RESPONSE'));
  }
});
test('AI refusal and incomplete responses are explicit; empty output is rejected',async()=>{
  for(const [value,code] of [[{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'synthetic'}]}]},'REFUSED'],[{status:'incomplete',output:[]},'INCOMPLETE'],[{status:'completed',output:[]},'INVALID_RESPONSE']] as const){const m=mock([json(value)]);await assert.rejects(createOpenAIAdapter({...aiOptions,fetch:m.fetch}).summarizeTasks([]),hasCode(code));}
});
test('AI validates request input before network',async()=>{
  const m=mock([]),ai=createOpenAIAdapter({...aiOptions,fetch:m.fetch});
  await assert.rejects(ai.extractTasks('Synthetic',{today:'2025-02-29',timeZone:'UTC'}),hasCode('INVALID_INPUT'));
  await assert.rejects(ai.extractTasks('Synthetic',{today:'2026-10-07',timeZone:'No/Such_Zone'}),hasCode('INVALID_INPUT'));
  await assert.rejects(ai.summarizeTasks([{title:''}]),hasCode('INVALID_INPUT'));assert.equal(m.calls.length,0);
});
test('transcription sends FormData without manually set boundary, validates text response',async()=>{
  const m=mock([json({text:'Synthetic transcript'})]),ai=createOpenAIAdapter({...aiOptions,fetch:m.fetch});
  assert.equal(await ai.transcribeAudio(new Blob(['synthetic bytes'],{type:'audio/wav'}),'mock.wav','zh'),'Synthetic transcript');
  const call=m.calls[0];assert.equal(call.url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(new Headers(call.init.headers).has('Content-Type'),false);
  const body=call.init.body as FormData;assert.equal(body.get('model'),'mock-transcription-model');assert.equal(body.get('language'),'zh');assert.equal(body.get('response_format'),'json');assert.equal((body.get('file') as File).name,'mock.wav');
});
test('transcription missing model, wrong file, zero byte and oversized file fail closed',async()=>{
  const m=mock([]),ai=createOpenAIAdapter({...aiOptions,fetch:m.fetch});
  await assert.rejects(createOpenAIAdapter({model:'mock',token:mockCredential,fetch:m.fetch}).transcribeAudio(new Blob(['x']),'mock.wav'),hasCode('NOT_CONFIGURED'));
  for(const [blob,name] of [[new Blob([]),'mock.wav'],[new Blob(['x']),'../mock.wav'],[new Blob(['x']),'mock.exe'],[new Blob([new Uint8Array(25*1024*1024+1)]),'mock.wav']] as const)await assert.rejects(ai.transcribeAudio(blob,name),hasCode('INVALID_INPUT'));
  assert.equal(m.calls.length,0);
});
test('Google paginated list encodes IDs/query and returns cancellation tombstone and next token',async()=>{
  const m=mock([json({items:[providerEvent,{id:'deleted',status:'cancelled'}],nextPageToken:'page + two'}),json({items:[],nextSyncToken:'sync-token'})]);const g=createGoogleCalendarAdapter({token:mockCredential,fetch:m.fetch});
  const first=await g.listEvents('mock/calendar@example.invalid',{timeMin:'2026-10-07T00:00:00Z',timeMax:'2026-10-09T00:00:00+08:00',singleEvents:true,orderBy:'startTime',maxResults:2500});
  assert.equal(first.items.length,2);assert.equal(first.nextPageToken,'page + two');assert.ok(m.calls[0].url.includes('mock%2Fcalendar%40example.invalid'));assert.equal(new URL(m.calls[0].url).searchParams.get('maxResults'),'2500');
  const second=await g.listEvents('primary',{pageToken:first.nextPageToken});assert.equal(second.nextSyncToken,'sync-token');assert.equal(new URL(m.calls[1].url).searchParams.get('pageToken'),'page + two');
});
test('Google create uses POST; patch preserves fields with If-Match; delete accepts 204',async()=>{
  const m=mock([json(providerEvent),json({...providerEvent,summary:'Updated synthetic title'}),new Response(null,{status:204})]);const g=createGoogleCalendarAdapter({token:mockCredential,fetch:m.fetch});
  assert.equal((await g.createEvent('primary',event)).id,'mockid');
  assert.equal((await g.updateEvent('primary','mock/id',{summary:'Updated synthetic title'},'"mock-etag"')).summary,'Updated synthetic title');
  await g.deleteEvent('primary','mock/id','"mock-etag"');
  assert.deepEqual(m.calls.map(c=>c.init.method),['POST','PATCH','DELETE']);assert.equal(new Headers(m.calls[1].init.headers).get('If-Match'),'"mock-etag"');assert.equal(JSON.parse(String(m.calls[1].init.body)).start,undefined);assert.ok(m.calls[1].url.includes('mock%2Fid'));m.calls.forEach(c=>assert.equal(new URL(c.url).searchParams.get('sendUpdates'),'none'));
});
test('Google handles timed events with offset or named zone and rejects malformed ranges',async()=>{
  const timed={...event,start:{dateTime:'2026-10-07T09:00:00+08:00'},end:{dateTime:'2026-10-07T10:00:00+08:00'}};
  const local={...event,start:{dateTime:'2026-10-07T09:00:00',timeZone:'Asia/Shanghai'},end:{dateTime:'2026-10-07T10:00:00',timeZone:'Asia/Shanghai'}};
  const m=mock([json({...providerEvent,...timed}),json({...providerEvent,...local})]);const g=createGoogleCalendarAdapter({token:mockCredential,fetch:m.fetch});await g.createEvent('primary',timed);await g.createEvent('primary',local);
  for(const bad of [{...event,end:{date:'2026-10-07'}},{...event,start:{date:'2026-02-30'}},{...timed,end:{dateTime:'2026-10-07T08:00:00+08:00'}},{...timed,start:{dateTime:'2026-10-07T09:00:00'}},{...event,start:{date:'2026-10-07',dateTime:'2026-10-07T09:00:00Z'}},{...event,attendees:[{email:'mock@example.invalid'}]},{...timed,start:{dateTime:'2026-10-07T09:00:00+25:00'}}])await assert.rejects(g.createEvent('primary',bad as GoogleEventInput),hasCode('INVALID_INPUT'));
  await assert.rejects(g.updateEvent('primary','id',{start:{date:'2026-10-09'}},'etag'),hasCode('INVALID_INPUT'));
  await assert.rejects(g.updateEvent('primary','id',{},'etag'),hasCode('INVALID_INPUT'));await assert.rejects(g.deleteEvent('primary','id','bad\r\nheader'),hasCode('INVALID_INPUT'));assert.equal(m.calls.length,2);
});
test('Google query constraints prevent illegal sync and ordered requests',async()=>{
  const m=mock([]),g=createGoogleCalendarAdapter({token:mockCredential,fetch:m.fetch});
  for(const q of [{maxResults:2501},{timeMin:'yesterday'},{timeMin:'2026-10-09T00:00:00Z',timeMax:'2026-10-07T00:00:00Z'},{syncToken:'sync',timeMin:'2026-10-07T00:00:00Z'},{syncToken:'sync',showDeleted:false},{orderBy:'startTime'},{timeZone:'Fake/Timezone'}] as const)await assert.rejects(g.listEvents('primary',q),hasCode('INVALID_INPUT'));
  assert.equal(m.calls.length,0);
});
test('Google response schema validates provider output and drops unvalidated metadata',async()=>{
  const m=mock([json({items:[{...providerEvent,privateExtra:'do not expose'}]}),json({items:[{id:'bad',start:{date:'bad'},end:{date:'2026-10-08'}}]}),json({items:'not array'})]);const g=createGoogleCalendarAdapter({token:mockCredential,fetch:m.fetch});
  assert.equal('privateExtra' in (await g.listEvents('primary')).items[0],false);
  await assert.rejects(g.listEvents('primary'),hasCode('INVALID_RESPONSE'));await assert.rejects(g.listEvents('primary'),hasCode('INVALID_RESPONSE'));
});
test('HTTP errors are sanitized with status and stable retry/reauthorize indicators',async()=>{
  for(const [status,code] of [[401,'UNAUTHORIZED'],[403,'UNAUTHORIZED'],[429,'RATE_LIMITED'],[412,'CONFLICT'],[410,'SYNC_EXPIRED'],[500,'PROVIDER_ERROR']] as const){
    const m=mock([json({error:{message:`provider echoed ${mockCredential} private content`}},status)]);const g=createGoogleCalendarAdapter({token:mockCredential,fetch:m.fetch});
    await assert.rejects(g.listEvents('primary'),e=>{assert.ok(e instanceof IntegrationError);assert.equal(e.code,code);assert.equal(e.status,status);assert.equal(e.message.includes(mockCredential),false);assert.equal(e.message.includes('private'),false);return true;});
  }
});
test('invalid JSON and network failures do not leak provider or credential detail',async()=>{
  const m=mock([new Response('non-json')]);await assert.rejects(createGoogleCalendarAdapter({token:mockCredential,fetch:m.fetch}).listEvents('primary'),hasCode('INVALID_RESPONSE'));
  const fetch:FetchLike=async()=>{throw Error(`leaked ${mockCredential}`);};await assert.rejects(createGoogleCalendarAdapter({token:mockCredential,fetch}).listEvents('primary'),hasCode('NETWORK'));
});
test('timeout aborts injected request and returns sanitized TIMEOUT',async()=>{
  const fetch:FetchLike=(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('synthetic abort')),{once:true}));
  await assert.rejects(createGoogleCalendarAdapter({token:mockCredential,fetch,timeoutMs:5}).listEvents('primary'),hasCode('TIMEOUT'));
});
test('malformed extraction context rejects safely without network',async()=>{
  const m=mock([]),ai=createOpenAIAdapter({...aiOptions,fetch:m.fetch});await assert.rejects(ai.extractTasks('Synthetic',null as never),hasCode('INVALID_INPUT'));assert.equal(m.calls.length,0);
});
