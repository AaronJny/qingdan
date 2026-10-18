'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { recoveryPage } = require('../src/local-recovery-page.cjs');
const { css } = require('../src/local-pages.cjs');
const { t } = require('../src/language.cjs');
const translations = require('../src/translations.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function element(tagName = '') {
  const events = {};
  return {
    tagName, hidden: false, disabled: false, textContent: '', value: '',
    style: {}, attributes: {}, children: [],
    addEventListener(name, fn) { events[name] = fn; },
    dispatch(name) { return events[name]?.(); },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; this.textContent = ''; },
  };
}

async function harness({ locale = 'zh-CN', items = [], failCandidates = false } = {}) {
  const elements = {};
  // Seed the mocked DOM from the shipped page, including initial hidden state.
  for (const [, tag, attrs, id, tail] of recoveryPage().matchAll(/<(\w+)\b([^>]*?)\bid="([^"]+)"([^>]*)>/g)) {
    const node = element(tag);
    node.hidden = /\bhidden\b/.test(attrs + tail);
    node.disabled = /\bdisabled\b/.test(attrs + tail);
    elements[id] = node;
  }
  const calls = { summary: 0, candidates: [], export: 0, continue: 0 };
  const window = {
    qingdanT: key => t(key, locale),
    qingdanRecovery: {
      async summary() { calls.summary++; return { status: 'pending', requiresReview: true }; },
      async candidates(offset) {
        calls.candidates.push(offset);
        if (failCandidates) throw new Error('Synthetic private diagnostic');
        const page = items.slice(offset, offset + 25);
        return { items: page, total: items.length, nextOffset: offset + page.length < items.length ? offset + page.length : null };
      },
      async export() { calls.export++; return { saved: true }; },
      async continue() { calls.continue++; },
    },
  };
  const document = { getElementById: id => elements[id], createElement: element };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/recovery.js'), 'utf8'), { window, document });
  await flush();
  return { elements, calls, async click(id) { await elements[id].dispatch('click'); await flush(); } };
}

test('native hidden controls override shared display styling and start hidden', async () => {
  // Author display rules override the browser's built-in [hidden] rule unless
  // the local stylesheet explicitly preserves the hidden contract.
  assert.match(css, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/);
  assert.match(css, /a,button\{display:inline-block/);
  const h = await harness();
  assert.equal(h.elements.candidates.hidden, true);
  assert.equal(h.elements.more.hidden, true);
  assert.deepEqual(h.calls, { summary: 1, candidates: [], export: 0, continue: 0 });
});

test('zero, three and exactly 25 candidates never expose a next page', async () => {
  for (const count of [0, 3, 25]) {
    const h = await harness({ items: Array.from({ length: count }, () => ({ kind: 'quick-draft', value: 'Preserved text' })) });
    await h.click('view');
    assert.equal(h.elements.candidates.hidden, false);
    assert.equal(h.elements.candidates.children.length, count);
    assert.equal(h.elements.more.hidden, true);
    if (!count) assert.equal(h.elements.candidates.textContent, t('desktop.recovery.no.candidates', 'zh-CN'));
    await h.click('more'); // Even a synthetic click cannot request a nonexistent page.
    assert.deepEqual(h.calls.candidates, [0]);
    assert.equal(h.calls.export, 0);
    assert.equal(h.calls.continue, 0);
  }
});

test('25-item pages show next only until the final page and viewing again restarts at one', async () => {
  const h = await harness({ items: Array.from({ length: 28 }, (_, i) => ({ kind: 'quick-draft', value: `Input ${i + 1}` })) });
  await h.click('view');
  assert.equal(h.elements.candidates.children.length, 25);
  assert.equal(h.elements.more.hidden, false);
  await h.click('more');
  assert.equal(h.elements.candidates.children.length, 3);
  assert.equal(h.elements.candidates.children[0].children[0].textContent, '候选 26 · 快速录入草稿');
  assert.equal(h.elements.more.hidden, true);
  await h.click('view');
  assert.equal(h.elements.candidates.children.length, 25);
  assert.equal(h.elements.candidates.children[0].children[0].textContent, '候选 1 · 快速录入草稿');
  assert.equal(h.elements.more.hidden, false);
  assert.deepEqual(h.calls.candidates, [0, 25, 0]);
});

test('candidate headings use exact bilingual labels while raw input stays unchanged and read-only', async () => {
  const value = '<script>not executable</script> 原始输入';
  for (const [locale, expected] of [
    ['zh-CN', ['候选 1 · 语言偏好', '候选 2 · 未确认的新建操作', '候选 3 · 快速录入草稿']],
    ['en', ['Candidate 1 · Language preference', 'Candidate 2 · Unconfirmed creation', 'Candidate 3 · Quick-entry draft']],
  ]) {
    const h = await harness({ locale, items: ['language', 'queue-create', 'quick-draft'].map(kind => ({ kind, value, candidateId: 'private-hash', key: 'private-principal' })) });
    await h.click('view');
    assert.deepEqual(h.elements.candidates.children.map(row => row.children[0].textContent), expected);
    for (const [i, row] of h.elements.candidates.children.entries()) {
      const body = row.children[1];
      assert.equal(body.value, value);
      assert.equal(body.readOnly, true);
      assert.equal(body.attributes['aria-label'], expected[i]);
      assert.doesNotMatch(row.children[0].textContent, /private-hash|private-principal|queue-create|quick-draft/);
    }
    assert.equal(h.calls.export, 0);
    assert.equal(h.calls.continue, 0);
  }
});

test('all supported storage categories have bilingual display labels and unknown kinds stay generic', async () => {
  const kinds = ['language', 'quick-draft', 'desktop-quick-draft', 'batch-tag-draft', 'queue-create', 'pending-create', 'queue-write', 'pending-write', 'pending-import', 'pending-template', 'matrix-draft', 'calendar-batch', 'draft', 'check-draft', 'subtask-draft', 'comment-draft', 'focus-note', 'view', 'full-backup-pending', 'habit-group-rename', 'reminder-actions', 'offline-shell-opt', 'offline', 'offline-shell-session', 'comment-mentions', 'background-upload', 'attachment-upload', 'list-transfer', 'form-draft'];
  for (const locale of ['zh-CN', 'en']) {
    for (let offset = 0; offset < kinds.length; offset += 25) {
      const h = await harness({ locale, items: kinds.slice(offset, offset + 25).map(kind => ({ kind, value: '' })) });
      await h.click('view');
      for (const row of h.elements.candidates.children) {
        const label = row.children[0].textContent.split(' · ')[1];
        assert.ok(label);
        assert.notEqual(label, translations['desktop.recovery.kind.other'][locale]);
        assert.doesNotMatch(label, /^desktop\./);
        if (locale === 'zh-CN') assert.match(label, /[\u4e00-\u9fff]/);
      }
    }
    const h = await harness({ locale, items: [undefined, '__proto__', 'constructor', '<script>raw-kind</script>'].map(kind => ({ kind })) });
    await h.click('view');
    for (const row of h.elements.candidates.children) {
      assert.equal(row.children[0].textContent.split(' · ')[1], translations['desktop.recovery.kind.other'][locale]);
      assert.equal(row.children[1].value, translations['desktop.recovery.unreadable'][locale]);
      assert.equal(row.children[1].readOnly, true);
    }
  }
});

test('failed candidate reads keep controls hidden and do not expose private diagnostics', async () => {
  const h = await harness({ failCandidates: true });
  await h.click('view');
  assert.equal(h.elements.candidates.hidden, true);
  assert.equal(h.elements.more.hidden, true);
  assert.equal(h.elements.message.textContent, t('desktop.recovery.error', 'zh-CN'));
  assert.equal(h.calls.export, 0);
  assert.equal(h.calls.continue, 0);
});
