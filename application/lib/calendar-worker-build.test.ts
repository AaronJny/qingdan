import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildServer } from '../scripts/build-server.mjs';

test('the server build emits the isolated calendar worker and bundled parsing succeeds or fails closed', async () => {
  // Keep external production dependency resolution intact without changing dist.
  const output = await mkdtemp(join(resolve('node_modules'), '.qingdan-worker-build-'));
  try {
    await buildServer(output);
    const worker = await readFile(join(output, 'calendar-worker.mjs'), 'utf8');
    assert.match(worker, /parentPort/);
    assert.match(await readFile(join(output, 'main.mjs'), 'utf8'), /\.\/calendar-worker\.mjs/);
    await build({
      entryPoints: { 'isolated-parser': 'lib/calendar-ics-isolated.ts' },
      outdir: output, outExtension: { '.js': '.mjs' }, bundle: true,
      platform: 'node', target: 'node24', format: 'esm', packages: 'external',
    });
    const { parseCalendarIsolated } = await import(pathToFileURL(join(output, 'isolated-parser.mjs')).href);
    const range = { from: '2026-10-01T00:00:00Z', through: '2026-11-01T00:00:00Z', timeZone: 'Asia/Shanghai' };
    const feed = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-built-worker\r\nDTSTART:20261009T090000Z\r\nDTEND:20261009T100000Z\r\nSUMMARY:Synthetic packaged calendar\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const events = await parseCalendarIsolated(feed, range);
    assert.equal(events.length, 1);
    assert.equal(events[0].title, 'Synthetic packaged calendar');
    assert.equal(events[0].start, '2026-10-09T09:00:00.000Z');
    assert.equal(events[0].readOnly, true);
    await assert.rejects(parseCalendarIsolated('<html>Invalid synthetic feed</html>', range), /日历内容无效/);
  } finally { await rm(output, { recursive: true, force: true }); }
});
