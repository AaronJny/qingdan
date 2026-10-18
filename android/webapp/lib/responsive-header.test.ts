import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { LOCALES, messages } from './i18n';

test('translated view controls retain intrinsic width and wrap at desktop and mobile breakpoints', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  for (const width of [1180, 500, 320]) {
    const window = new Window({ width, height: 800 });
    const document = window.document;
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    document.body.innerHTML = '<header class="workspace-header"><div class="header-left"><h1>Preserved user title</h1></div><div class="header-actions"><button class="icon-button">A</button><select class="header-select"></select><button class="icon-button">B</button></div></header>';
    const header = document.querySelector('.workspace-header')!;
    const actions = document.querySelector('.header-actions')!;
    const select = document.querySelector('select')!;
    for (const locale of LOCALES) {
      document.documentElement.lang = locale;
      select.setAttribute('aria-label', messages[locale]['workspace.view']);
      select.replaceChildren(...['workspace.listView', 'workspace.board', 'workspace.timeline'].map(key => { const option = document.createElement('option'); option.textContent = messages[locale][key]; return option; }));
      const controlStyle = window.getComputedStyle(select);
      assert.equal(controlStyle.width, 'auto', `${locale} at ${width}px retains native content sizing`);
      assert.equal(controlStyle.maxWidth, '100%', 'No legacy 90px/72px translation clipping');
      assert.equal(controlStyle.flexShrink, '0');
      assert.equal(window.getComputedStyle(header).height, 'auto');
      assert.equal(window.getComputedStyle(header).flexWrap, 'wrap');
      assert.equal(window.getComputedStyle(actions).flexWrap, 'wrap');
      assert.equal(window.getComputedStyle(actions).maxWidth, '100%');
      assert.equal(select.getAttribute('aria-label'), messages[locale]['workspace.view']);
      assert.equal(select.options[0].textContent, messages[locale]['workspace.listView']);
    }
    window.happyDOM.abort();
  }
});
