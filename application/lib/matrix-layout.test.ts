import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
const matrixRule = css.match(/\.matrix-grid\{([^}]*)\}/)?.[1] ?? '';
const cellRule = css.match(/\.matrix-grid>section\{([^}]*)\}/)?.[1] ?? '';

test('matrix rows size independently by content while columns stay aligned per row', () => {
  assert.match(matrixRule, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(matrixRule, /grid-template-rows:repeat\(2,minmax\(200px,max-content\)\)/);
  assert.match(matrixRule, /align-content:start/);
  assert.doesNotMatch(matrixRule, /1fr\) minmax\(200px,1fr\)/);
  assert.match(cellRule, /min-height:200px/);
});

test('matrix headings can wrap long titles without widening the grid', () => {
  assert.match(css, /\.matrix-grid h2\{[^}]*min-width:0[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.matrix-grid>section>header\{[^}]*min-width:0/);
});
