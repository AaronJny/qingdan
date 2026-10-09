import { parentPort, workerData } from 'node:worker_threads';
import { parseCalendarIcs } from './calendar-ics.ts';
try { parentPort!.postMessage({events:parseCalendarIcs(workerData.text,workerData.range)}); }
catch { parentPort!.postMessage({error:'日历内容无效或重复规则不受支持；上次有效数据仍保留。'}); }
