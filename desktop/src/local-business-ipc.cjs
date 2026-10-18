'use strict';
const { isServiceUrl } = require('./policy.cjs');
function trustedLocalBusinessSender(event, { connection, backend, windows, store, quitting, expectedSession }) {
  return !quitting && !!connection?.builtin && backend?.status === 'ready' && backend.backendOrigin === connection.origin && !!store && !!expectedSession &&
    windows.some(window => window && !window.isDestroyed() && event?.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isServiceUrl(event.senderFrame?.url,connection) && window.webContents.session === expectedSession);
}
function handleLocalBusiness(event, request, context) {
  if (!trustedLocalBusinessSender(event,context)) return { ok:false,code:'UNTRUSTED_LOCAL_SENDER',error:'Local input storage is available only to the owned local app.' };
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Invalid local storage request');
    const allowed = { snapshot:['operation'],keys:['operation'],get:['operation','key'],set:['operation','key','value','expectedRevision'],remove:['operation','key','expectedRevision'] }[request.operation];
    if (!allowed || Object.keys(request).length !== allowed.length || Object.keys(request).some(key=>!allowed.includes(key))) throw new TypeError('Invalid local storage request');
    let result;
    if (request.operation === 'snapshot') result = context.store.snapshot();
    else if (request.operation === 'keys') result = context.store.keys();
    else if (request.operation === 'get') result = context.store.read(request.key);
    else {
      if (request.operation === 'set' && typeof request.value !== 'string') throw new TypeError('Invalid local storage value');
      result = context.store.write(request.key, request.operation === 'remove' ? null : request.value, request.expectedRevision);
      if (result.changed) for (const window of context.windows) if (window && !window.isDestroyed() && window.webContents !== event.sender && isServiceUrl(window.webContents.mainFrame?.url,context.connection)) window.webContents.send('qingdan-local-business:changed',{key:request.key,oldValue:result.oldValue,newValue:result.value});
    }
    return {ok:true,result};
  } catch (error) { return {ok:false,code:error.code || 'LOCAL_STORAGE_INVALID',error:error.message}; }
}
module.exports = { trustedLocalBusinessSender,handleLocalBusiness };
