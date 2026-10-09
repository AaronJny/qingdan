'use strict';

const path = require('node:path');
const httpDefault = require('node:http');
const { pathToFileURL } = require('node:url');
const { validPort, validateLocalInfo, HOST } = require('./backend-manager.cjs');

function launchConfiguration(args, env) {
  const [launchId, backendRoot] = args;
  const port = Number(env.PORT);
  if (args.length !== 2 || typeof launchId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(launchId)
    || typeof backendRoot !== 'string' || !path.isAbsolute(backendRoot) || backendRoot.includes('\0')
    || !validPort(port) || String(port) !== env.PORT || env.HOST !== HOST
    || env.APP_MODE !== 'local' || env.QINGDAN_MODE !== 'local'
    || env.APP_ORIGIN !== `http://${HOST}:${port}`
    || !path.isAbsolute(env.QINGDAN_DATA_DIR || '') || env.QINGDAN_DATA_DIR.includes('\0')) {
    throw Object.assign(new Error('Invalid embedded backend configuration.'), { code: 'INVALID_CONFIGURATION' });
  }
  return { launchId, backendRoot, port, origin: env.APP_ORIGIN };
}

// Observe the unmodified entry point's startup only. Requests/auth/storage are untouched.
function observeStartupListen(http, configuration, callbacks) {
  const prototype = http.Server.prototype;
  const original = prototype.listen;
  let observedServer = null;
  function listen(...args) {
    if (observedServer && observedServer !== this || args[0] !== configuration.port || args[1] !== HOST) {
      throw Object.assign(new Error('Unexpected embedded backend listen address.'), { code: 'INVALID_BIND' });
    }
    observedServer = this;
    this.once('listening', () => {
      const address = this.address();
      if (!address || address.address !== HOST || address.port !== configuration.port || !validPort(address.port)) {
        callbacks.error(Object.assign(new Error('Invalid backend bound address.'), { code: 'INVALID_BIND' }));
        return;
      }
      callbacks.listening({ address: address.address, port: address.port });
    });
    this.once('error', error => callbacks.error(error));
    return Reflect.apply(original, this, args);
  }
  prototype.listen = listen;
  return () => { if (prototype.listen === listen) prototype.listen = original; };
}

async function probeLocalInfo(origin, fetch_ = globalThis.fetch, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const target = `${origin}/api/app-info`;
  try {
    const response = await fetch_(target, {
      method: 'GET', headers: { Accept: 'application/json' },
      redirect: 'error', credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal,
    });
    if (!response.ok || response.redirected || response.url && response.url !== target
      || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')
      || Number(response.headers.get('content-length') || 0) > 8192) throw Error('Incompatible local backend.');
    const reader = response.body?.getReader();
    if (!reader) throw Error('Empty local backend response.');
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) { await reader.cancel(); throw Error('Local backend response too large.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const info = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!validateLocalInfo(info)) throw Error('Incompatible local backend.');
    return Object.freeze({ app: info.app, version: info.version, mode: info.mode });
  } finally { clearTimeout(timer); controller.abort(); }
}

async function startBootstrap(options = {}) {
  const process_ = options.process || process;
  const parentPort = options.parentPort || process_.parentPort;
  const configuration = launchConfiguration(options.args || process_.argv.slice(2), process_.env);
  if (!parentPort || typeof parentPort.postMessage !== 'function') throw Error('An owned parent port is required.');
  const http = options.http || httpDefault;
  const importMain = options.importMain || (url => import(url));
  const probe = options.probe || probeLocalInfo;
  let imported = false, bound = null, probing = false, stopping = false, failed = false, shutdownEmitted = false;
  const send = message => parentPort.postMessage({ ...message, launchId: configuration.launchId });
  const shutdown = () => {
    if (shutdownEmitted || !imported) return;
    shutdownEmitted = true;
    // Reuse the entry point's app.close/closeIdleConnections/closeStorage handlers.
    if (process_.listenerCount('SIGTERM')) process_.emit('SIGTERM');
    else process_.exit(failed ? 1 : 0);
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    try { send({ kind: 'qingdan-backend-stopping' }); } catch {}
    shutdown();
  };
  const error = cause => {
    if (failed || stopping) return;
    failed = true;
    try { send({ kind: 'qingdan-backend-error', code: cause?.code === 'EADDRINUSE' ? 'EADDRINUSE' : 'BACKEND_STARTUP' }); } catch {}
    stop();
  };
  const ready = async () => {
    if (!imported || !bound || probing || stopping || failed) return;
    probing = true;
    try {
      const info = await probe(configuration.origin);
      if (!validateLocalInfo(info)) throw Error('Incompatible local backend.');
      if (!stopping && !failed) send({ kind: 'qingdan-backend-ready', ...bound, info });
    } catch (cause) { error(cause); }
  };
  parentPort.on('message', event => {
    const message = event?.data || event;
    if (message?.kind === 'qingdan-backend-shutdown' && message.launchId === configuration.launchId) stop();
  });
  parentPort.on('close', stop);
  const restore = observeStartupListen(http, configuration, {
    listening: address => { bound = address; void ready(); }, error,
  });
  try {
    await importMain(pathToFileURL(path.join(configuration.backendRoot, 'dist/server/main.mjs')).href);
    imported = true;
  } catch (cause) {
    imported = true;
    error(cause);
  } finally { restore(); }
  if (stopping) shutdown();
  else await ready();
  return { configuration, stop };
}

if (require.main === module) {
  void startBootstrap().catch(() => process.exit(1));
}

module.exports = { launchConfiguration, observeStartupListen, probeLocalInfo, startBootstrap };
