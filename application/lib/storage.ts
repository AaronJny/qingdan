import { createLocalStorage, storagePaths, type StorageOptions } from './local-storage.ts';

let storage: ReturnType<typeof createLocalStorage> | undefined;
let configured: ReturnType<typeof storagePaths> | undefined;
export function initializeStorage(options: StorageOptions = {}) {
  const paths = storagePaths(options);
  if (storage) {
    if (configured?.mode !== paths.mode || configured?.dataDir !== paths.dataDir || configured?.migrationsDir !== paths.migrationsDir) throw new Error('Storage is already initialized with a different mode or directory. Close it before changing configuration.');
    return storage;
  }
  storage = createLocalStorage(options);
  configured = paths;
  return storage;
}
export function closeStorage() {
  storage?.close();
  storage = undefined;
  configured = undefined;
}
export function database(): D1Database { return (storage || initializeStorage()).database; }
export function bucket() { return (storage || initializeStorage()).bucket; }
export function localPrincipalId(): string {
  const current = storage || initializeStorage();
  if (current.mode !== 'local' || !current.localPrincipalId) throw new Error('Local identity is available only in local mode.');
  return current.localPrincipalId;
}
