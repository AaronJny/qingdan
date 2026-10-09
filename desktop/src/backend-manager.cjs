'use strict';

const fsDefault = require('node:fs');
const netDefault = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

const HOST = '127.0.0.1';
const RUNTIME_ENV_KEYS = Object.freeze([
  'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  '__CF_USER_TEXT_ENCODING',
]);

function backendError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function buildBackendEnvironment(parentEnv, port, dataDir) {
  if (!validPort(port)) throw backendError('INVALID_PORT', 'Invalid backend port.');
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir) || dataDir.includes('\0')) {
    throw backendError('INVALID_DATA_DIR', 'Backend data directory must be absolute.');
  }
  const env = {};
  for (const key of RUNTIME_ENV_KEYS) {
    const value = parentEnv?.[key];
    if (typeof value === 'string' && value.length <= 32768 && !value.includes('\0')) env[key] = value;
  }
  return Object.assign(env, {
    APP_MODE: 'local', QINGDAN_MODE: 'local', HOST,
    PORT: String(port), APP_ORIGIN: `http://${HOST}:${port}`,
    QINGDAN_DATA_DIR: dataDir,
  });
}

function validateLocalInfo(info) {
  return !!info && typeof info === 'object' && !Array.isArray(info)
    && Object.keys(info).every(key => ['app', 'version', 'mode'].includes(key))
    && info.app === 'qingdan' && info.mode === 'local'
    && typeof info.version === 'string' && info.version.length <= 64
    && /^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/.test(info.version);
}

// This socket only reserves a candidate. It never probes or adopts a service.
function reserveLoopbackPort(net, preferredPort, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const server = net.createServer();
    let settled = false;
    const finish = (error, port) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      server.removeListener('error', onError);
      if (error) reject(error); else resolve(port);
    };
    const onError = error => finish(error);
    const abort = () => {
      // close() also cancels a listen that has not completed yet.
      try { server.close(() => finish(signal.reason)); } catch { finish(signal.reason); }
    };
    server.once('error', onError);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      server.listen({ host: HOST, port: preferredPort || 0, exclusive: true }, () => {
        if (settled || signal?.aborted) { abort(); return; }
        const address = server.address();
        if (!address || address.address !== HOST || !validPort(address.port)) {
          server.close(() => finish(backendError('INVALID_BIND', 'Invalid loopback reservation.')));
          return;
        }
        const port = address.port;
        server.close(error => finish(error, port));
      });
    } catch (error) { finish(error); }
  });
}

class BackendManager extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.utilityProcess || typeof options.utilityProcess.fork !== 'function') {
      throw new TypeError('utilityProcess.fork is required.');
    }
    if (typeof options.userData !== 'string' || !path.isAbsolute(options.userData) || options.userData.includes('\0')) {
      throw new TypeError('userData must be an absolute profile path.');
    }
    this.utilityProcess = options.utilityProcess;
    this.fs = options.fs || fsDefault;
    this.net = options.net || netDefault;
    this.userData = options.userData;
    this.dataDir = path.join(this.userData, 'local-data');
    this.preferencesPath = path.join(this.userData, 'local-backend.json');
    this.backendRoot = path.resolve(options.backendRoot || path.join(__dirname, '../backend'));
    this.bootstrapPath = path.resolve(options.bootstrapPath || path.join(__dirname, 'backend-bootstrap.cjs'));
    this.parentEnv = options.parentEnv || process.env;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 20000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 12000;
    this.killTimeoutMs = options.killTimeoutMs ?? 3000;
    this.maxAttempts = options.maxAttempts ?? 3;
    for (const key of ['startupTimeoutMs', 'shutdownTimeoutMs', 'killTimeoutMs', 'maxAttempts']) {
      if (!Number.isSafeInteger(this[key]) || this[key] < 1) throw new TypeError(`Invalid ${key}.`);
    }
    this.reservePort = options.reservePort || ((port, signal) => reserveLoopbackPort(this.net, port, signal));
    this._status = 'idle';
    this._origin = null;
    this._pending = null;
    this._stopping = null;
    this._token = null;
    this._owned = null;
    this._generation = 0;
  }

  get status() { return this._status; }
  get backendOrigin() { return this._origin; }

  _state(status, error = null) {
    this._status = status;
    this.emit('status', Object.freeze({ status, origin: this._origin, error }));
  }

  _preferredPort() {
    try {
      const value = JSON.parse(this.fs.readFileSync(this.preferencesPath, 'utf8'));
      return value?.version === 1 && validPort(value.port) ? value.port : null;
    } catch { return null; }
  }

  _savePort(port) {
    const temporary = `${this.preferencesPath}.${randomUUID()}.tmp`;
    try {
      this.fs.mkdirSync(this.userData, { recursive: true, mode: 0o700 });
      this.fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, port })}\n`, { mode: 0o600, flag: 'wx' });
      this.fs.renameSync(temporary, this.preferencesPath);
    } catch {
      try { this.fs.unlinkSync(temporary); } catch {}
      // Preference metadata is optional; local data is never removed or migrated here.
      this.emit('warning', backendError('PORT_PREFERENCE', 'The local port preference could not be saved.'));
    }
  }

  ensureLocal() {
    if (this._stopping) return Promise.reject(backendError('BACKEND_STOPPING', 'The local backend is stopping.'));
    if (this._pending) return this._pending;
    if (this._owned && !this._owned.exited) {
      if (this._status === 'ready') return Promise.resolve(this._origin);
      return Promise.reject(backendError('BACKEND_BUSY', 'The previous local backend has not exited.'));
    }
    const token = { generation: ++this._generation, controller: new AbortController(), cancelled: false };
    this._token = token;
    this._origin = null;
    // Publish the shared promise before emitting state; UI listeners can be reentrant.
    const pending = Promise.resolve().then(() => this._start(token));
    this._pending = pending;
    pending.then(() => this._clearPending(pending), () => this._clearPending(pending));
    this._state('starting');
    return pending;
  }

  _clearPending(pending) {
    if (this._pending === pending) this._pending = null;
  }

  async _start(token) {
    const { signal } = token.controller;
    const timeout = setTimeout(() => token.controller.abort(backendError('BACKEND_TIMEOUT', 'The local backend startup timed out.')), this.startupTimeoutMs);
    let preferred = this._preferredPort();
    try {
      this.fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
        if (signal.aborted) throw signal.reason;
        let port;
        try { port = await this.reservePort(preferred, signal); }
        catch (error) {
          if (!preferred || error?.code !== 'EADDRINUSE' || signal.aborted) throw error;
          port = await this.reservePort(null, signal);
        }
        preferred = null;
        if (signal.aborted) throw signal.reason;
        if (!validPort(port)) throw backendError('INVALID_PORT', 'Invalid reserved backend port.');
        const record = this._fork(token, port);
        try {
          await record.ready;
          if (signal.aborted) throw signal.reason;
          if (record.exited || this._owned !== record || this._token !== token) {
            throw backendError('BACKEND_EXITED', 'The local backend exited during startup.');
          }
          this._origin = `http://${HOST}:${port}`;
          this._savePort(port);
          this._state('ready');
          if (signal.aborted) throw signal.reason;
          if (record.exited || this._owned !== record) throw backendError('BACKEND_EXITED', 'The local backend exited during startup.');
          record.started = true;
          return this._origin;
        } catch (error) {
          await this._terminate(record);
          if (error?.code === 'EADDRINUSE' && !signal.aborted && attempt + 1 < this.maxAttempts) continue;
          throw error;
        }
      }
      throw backendError('EADDRINUSE', 'No free local backend port could be obtained.');
    } catch (error) {
      this._origin = null;
      if (!token.cancelled) {
        const safe = backendError(error?.code === 'BACKEND_TIMEOUT' ? 'BACKEND_TIMEOUT' : error?.code === 'EADDRINUSE' ? 'EADDRINUSE' : error?.code === 'BACKEND_SHUTDOWN_TIMEOUT' ? 'BACKEND_SHUTDOWN_TIMEOUT' : 'BACKEND_STARTUP', error?.code === 'BACKEND_TIMEOUT' ? 'The local backend startup timed out.' : 'The local backend could not start.');
        this._state('failed', safe);
        this.emit('failure', safe);
        throw safe;
      }
      throw backendError('BACKEND_CANCELLED', 'Local backend startup was cancelled.');
    } finally { clearTimeout(timeout); }
  }

  _fork(token, port) {
    const launchId = randomUUID();
    const child = this.utilityProcess.fork(this.bootstrapPath, [launchId, this.backendRoot], {
      env: buildBackendEnvironment(this.parentEnv, port, this.dataDir),
      stdio: 'ignore', serviceName: 'Qingdan local backend',
    });
    let resolveExit, resolveReady, rejectReady;
    const record = {
      child, launchId, port, token, exited: false, expectedExit: false, started: false,
      exit: new Promise(resolve => { resolveExit = resolve; }),
      ready: new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }),
    };
    this._owned = record;
    const signal = token.controller.signal;
    const abort = () => rejectReady(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const onMessage = message => {
      if (this._owned !== record || this._token !== token || token.cancelled || signal.aborted || record.exited
        || !message || message.launchId !== launchId) return;
      if (message.kind === 'qingdan-backend-error') {
        rejectReady(backendError(message.code === 'EADDRINUSE' ? 'EADDRINUSE' : 'BACKEND_STARTUP', 'The local backend could not start.'));
      } else if (message.kind === 'qingdan-backend-ready' && message.address === HOST && message.port === port && validateLocalInfo(message.info)) {
        resolveReady();
      }
    };
    const onError = () => rejectReady(backendError('BACKEND_STARTUP', 'The local backend process failed.'));
    const onExit = code => {
      if (record.exited) return;
      record.exited = true;
      signal.removeEventListener('abort', abort);
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      resolveExit(code);
      rejectReady(backendError('BACKEND_EXITED', 'The local backend exited during startup.'));
      if (this._owned === record) {
        this._owned = null;
        this._origin = null;
        if (!record.expectedExit && record.started && this._status === 'ready') {
          const error = backendError('BACKEND_CRASHED', 'The local backend stopped unexpectedly.');
          this._state('failed', error);
          this.emit('failure', error);
        }
      }
    };
    child.on('message', onMessage);
    child.on('error', onError);
    child.once('exit', onExit);
    // Avoid retaining the abort callback after readiness, while preserving exit monitoring.
    record.ready.then(() => signal.removeEventListener('abort', abort), () => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    return record;
  }

  _waitExit(record, milliseconds) {
    if (record.exited) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), milliseconds);
      record.exit.then(() => { clearTimeout(timer); resolve(true); });
    });
  }

  _terminate(record) {
    if (record.termination) return record.termination;
    record.expectedExit = true;
    record.termination = (async () => {
      if (record.exited) return;
      try { record.child.postMessage({ kind: 'qingdan-backend-shutdown', launchId: record.launchId }); } catch {}
      if (await this._waitExit(record, this.shutdownTimeoutMs)) return;
      // Only this owned child is ever killed, never a PID or a process discovered by HTTP.
      try { record.child.kill(); } catch {}
      if (!await this._waitExit(record, this.killTimeoutMs)) {
        throw backendError('BACKEND_SHUTDOWN_TIMEOUT', 'The local backend has not exited.');
      }
    })();
    return record.termination;
  }

  stop() {
    if (this._stopping) return this._stopping;
    const token = this._token;
    if (token) {
      token.cancelled = true;
      token.controller.abort(backendError('BACKEND_CANCELLED', 'Local backend startup was cancelled.'));
    }
    this._origin = null;
    const pending = this._pending;
    const owned = this._owned;
    const stopping = Promise.resolve().then(async () => {
      try {
        // Startup performs the same termination; both paths share one shutdown promise.
        if (owned) await this._terminate(owned);
        if (pending) await pending.catch(() => {});
        if (this._owned && !this._owned.exited) await this._terminate(this._owned);
        this._state('idle');
      } catch (error) {
        this._state('failed', error);
        this.emit('failure', error);
        throw error;
      }
    });
    this._stopping = stopping;
    stopping.then(() => { if (this._stopping === stopping) this._stopping = null; }, () => { if (this._stopping === stopping) this._stopping = null; });
    this._state('stopping');
    return stopping;
  }
}

function createBackendManager(options) { return new BackendManager(options); }

module.exports = { BackendManager, createBackendManager, buildBackendEnvironment, validPort, validateLocalInfo, reserveLoopbackPort, HOST, RUNTIME_ENV_KEYS };
