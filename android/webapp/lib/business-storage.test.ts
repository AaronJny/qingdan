import test from 'node:test';
import assert from 'node:assert/strict';
import { businessStorage } from './business-storage';

function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear() { data.clear(); },
    getItem(key) { return data.get(key) ?? null; },
    key(index) { return [...data.keys()][index] ?? null; },
    removeItem(key) { data.delete(key); },
    setItem(key, value) { data.set(key, value); },
  };
}

test('Android language storage keeps the persistent WebView store and never calls the local database bridge', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browserStorage = storage();
  const androidWindow = {
    __QINGDAN_ANDROID__: true,
    __QINGDAN_ANDROID_LOCAL__: true,
    localStorage: browserStorage,
    QingdanLocal: { invoke() { assert.fail('Language must not use the Android task database bridge'); } },
  };
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: androidWindow });
    assert.equal(businessStorage(), browserStorage);
    businessStorage().setItem('qingdan-language', 'en');
    assert.equal(browserStorage.getItem('qingdan-language'), 'en');
    businessStorage().removeItem('qingdan-language');
    assert.equal(browserStorage.getItem('qingdan-language'), null);
    assert.equal('qingdanDesktop' in androidWindow, false);
    assert.equal('qingdanLocalStorage' in androidWindow, false);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
