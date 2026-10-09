/** Server-side holiday updater. Machine data is never itself official evidence. */
import { createHash } from 'node:crypto';
import { CHINESE_HOLIDAY_YEARS, installVerifiedChineseHolidayYears, type ChineseHolidayYear } from '../assets/chinese-calendar.ts';
import { safeCalendarFetch } from './safe-calendar-fetch.ts';

export const CHINESE_HOLIDAY_SOURCE = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/';
// Runtime refresh is deliberately limited to the low-frequency machine JSON
// source. Official notices remain static attribution/evidence fixtures; the
// updater never contacts gov.cn (or any other official web site).
export const CHINESE_HOLIDAY_REFRESH_LIMITS = Object.freeze({ machineRequests: 3, officialRequests: 0, machineBytes: 128 * 1024, officialBytes: 1024 * 1024 });
export interface HolidayDay { name: string; date: string; isOffDay: boolean }
export interface HolidayDocument { year: number; papers: string[]; days: HolidayDay[] }
export interface HolidayFetchResponse { status: number; text: string; headers: Record<string, string> }
export type HolidayFetcher = (url: string, options?: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string>; maxRedirects?: number }) => Promise<HolidayFetchResponse>;
export interface HolidayHttpState { lastAttemptAt?: string; lastSuccessAt?: string; etag?: string; lastModified?: string; bodyHash?: string }
export interface HolidayOriginState { blocked?: boolean; blockedAt?: string; retryAt?: string }
export interface OfficialHolidayEvidence { url: string; title: string; noticeNumber: string; publishedDate: string; text: string; sha256: string; fetchedAt: string; sourceHash: string }
export interface ChineseHolidayCandidate { year: number; sourceUrl: string; sourceHash: string; sourceBody: string; fetchedAt: string }
export interface VerifiedChineseHolidayYear extends ChineseHolidayCandidate {
  verification: 'machine-source' | 'official-paper' | 'builtin-baseline';
  officialEvidence: OfficialHolidayEvidence[];
  lastSuccessAt: string;
}
export interface ChineseHolidayCache {
  version: 1;
  years: Record<string, VerifiedChineseHolidayYear>;
  pending: Record<string, ChineseHolidayCandidate>;
  /** Proofs are reused only for the same machine response hash. */
  papers: Record<string, OfficialHolidayEvidence>;
  http: Record<string, HolidayHttpState>;
  origins: Record<string, HolidayOriginState>;
  lastAttemptAt?: string;
}
export type ChineseHolidayRefreshStatus = 'updated' | 'unchanged' | 'unpublished' | 'pending' | 'error' | 'blocked' | 'deferred';
export interface ChineseHolidayRefreshResult { year: number; status: ChineseHolidayRefreshStatus; code?: string; message: string; lastAttemptAt: string; lastSuccessAt?: string; retryAt?: string; blocked?: boolean }
export interface ChineseHolidayRefreshOptions { cache?: unknown; years?: number[]; now?: Date; fetcher?: HolidayFetcher }
export interface ChineseHolidayRefreshOutput { cache: ChineseHolidayCache; results: ChineseHolidayRefreshResult[]; calendarYears: ChineseHolidayYear[]; requests: { machine: number; official: number } }
class HolidaySourceError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'HolidaySourceError'; } }
const fail = (code: string, message: string): never => { throw new HolidaySourceError(code, message); };
function record(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function keys(v: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(v).some(k => !allowed.includes(k))) fail('invalid_schema', '节假日数据包含不支持的字段'); }
function yearOK(v: unknown): v is number { return Number.isInteger(v) && Number(v) >= 2000 && Number(v) <= 2100; }
function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function isoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function addDay(value: string): string { return new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }
function shanghaiDate(now: Date): string { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
function machineUrl(year: number): string { return `${CHINESE_HOLIDAY_SOURCE}${year}.json`; }
const HOLIDAYS = ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'];
function holidayName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 30) return fail('invalid_schema', '节日名称无效');
  const names = value.split(/[、和]/);
  if (names.length < 1 || names.length > 2 || new Set(names).size !== names.length || names.some(n => !HOLIDAYS.includes(n)) || names.length === 2 && !names.every(n => n === '中秋节' || n === '国庆节')) return fail('invalid_schema', '节日名称无效');
  return names.sort().join('、');
}
export function isOfficialHolidayPaperUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'gov.cn' || u.hostname.endsWith('.gov.cn')) && !u.username && !u.password && !u.port && !u.search && !u.hash && /\.(?:html?|jhtml)$/.test(u.pathname) && u.href === value; } catch { return false; }
}
/** JSON.parse alone accepts duplicate member names. Refuse those, too. */
function rejectDuplicateMembers(text: string): void {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const string = (): string => { const start = i++; while (i < text.length) { if (text[i] === '\\') { i += 2; continue; } if (text[i++] === '"') return JSON.parse(text.slice(start, i)) as string; } return fail('invalid_json', '节假日 JSON 无效'); };
  const value = (depth: number): void => {
    if (depth > 12) fail('invalid_json', '节假日 JSON 嵌套过深'); ws();
    if (text[i] === '{') { i++; ws(); const seen = new Set<string>(); if (text[i] === '}') { i++; return; } while (i < text.length) { ws(); const key = string(); if (seen.has(key)) fail('duplicate', '节假日 JSON 包含重复字段'); seen.add(key); ws(); i++; value(depth + 1); ws(); if (text[i++] === '}') return; } }
    else if (text[i] === '[') { i++; ws(); if (text[i] === ']') { i++; return; } while (i < text.length) { value(depth + 1); ws(); if (text[i++] === ']') return; } }
    else if (text[i] === '"') string();
    else { while (i < text.length && !/[\s,\]}]/.test(text[i])) i++; }
  };
  value(0);
}
export function parseChineseHolidayDocument(text: string, expectedYear: number): HolidayDocument {
  if (!yearOK(expectedYear) || Buffer.byteLength(text) > CHINESE_HOLIDAY_REFRESH_LIMITS.machineBytes) fail('invalid_schema', '节假日源年份或大小无效');
  let raw: unknown; try { raw = JSON.parse(text); } catch { return fail('invalid_json', '节假日源不是有效 JSON'); }
  rejectDuplicateMembers(text);
  if (!record(raw)) return fail('invalid_schema', '节假日源结构无效');
  keys(raw, ['$schema', '$id', 'year', 'papers', 'days']);
  if (raw.year !== expectedYear || raw.$id !== undefined && raw.$id !== machineUrl(expectedYear) || raw.$schema !== undefined && raw.$schema !== `${CHINESE_HOLIDAY_SOURCE}schema.json` || !Array.isArray(raw.papers) || raw.papers.length > 3 || !Array.isArray(raw.days) || raw.days.length > 100) return fail('invalid_schema', '节假日源年份、标识或数组无效');
  if (raw.papers.some(p => !isOfficialHolidayPaperUrl(p)) || new Set(raw.papers).size !== raw.papers.length) return fail('invalid_paper', '官方证据必须是唯一的 HTTPS gov.cn 公告链接');
  if ((raw.papers.length === 0) !== (raw.days.length === 0)) return fail('invalid_schema', '节假日安排与官方证据不完整');
  const seen = new Set<string>();
  const days = raw.days.map(day => {
    if (!record(day)) return fail('invalid_schema', '节假日日条目无效'); keys(day, ['date', 'name', 'isOffDay']);
    if (typeof day.date !== 'string' || !isoDate(day.date) || typeof day.isOffDay !== 'boolean') return fail('invalid_schema', '节假日日期或工作日标志无效');
    if (day.date < `${expectedYear - 1}-12-01` || day.date > `${expectedYear}-12-31`) return fail('invalid_range', '节假日源包含超出公告年度及前一年十二月的日期');
    if (seen.has(day.date)) return fail('duplicate', '节假日源包含重复日期'); seen.add(day.date);
    return { date: day.date, name: holidayName(day.name), isOffDay: day.isOffDay };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { year: expectedYear, papers: raw.papers as string[], days };
}
function plainText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]+>/g, '').replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }).replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[\s\u200b\ufeff]+/g, '');
}
interface ParsedPaper { title: string; noticeNumber: string; publishedDate: string; days: HolidayDay[] }
/** A conservative grammar for annual State Council notices. Unknown wording fails closed. */
export function parseOfficialChineseHolidayPaper(html: string, year: number, today: string): ParsedPaper {
  const text = plainText(html);
  const title = `国务院办公厅关于${year}年部分节假日安排的通知`;
  if (!yearOK(year) || !isoDate(today) || !text.includes(title)) return fail('official_mismatch', '官方正文不是对应年度的国务院办公厅节假日通知');
  const number = text.match(/国办发明电〔(\d{4})〕(\d{1,3})号/);
  const intro = text.indexOf(`经国务院批准，现将${year}年`);
  if (!number || intro < 0) return fail('official_unrecognized', '无法识别官方通知编号或正文');
  const signed = /国务院办公厅(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text.slice(intro));
  if (!signed) return fail('official_unrecognized', '官方通知缺少落款日期');
  const publishedDate = `${signed[1]}-${signed[2].padStart(2, '0')}-${signed[3].padStart(2, '0')}`;
  if (!isoDate(publishedDate) || publishedDate > today || Number(signed[1]) < year - 1 || Number(signed[1]) > year || signed[1] !== number[1]) return fail('official_date', '官方通知落款日期无效或尚未发布');
  const body = text.slice(intro, intro + signed.index);
  const sections = [...body.matchAll(/([一二三四五六七八九十]+)、([^：:。]{1,25})[：:]/g)];
  if (sections.length < 6 || sections.length > 7) return fail('official_unrecognized', '官方年度通知未包含完整的全国节假日安排');
  const allNames = new Set<string>(), dayMap = new Map<string, HolidayDay>();
  const numeral = ['一', '二', '三', '四', '五', '六', '七'];
  function dateToken(token: string, inheritedMonth?: number, inheritedYear = year): string {
    const m = /^(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日$/.exec(token);
    if (!m || !m[2] && inheritedMonth === undefined) return fail('official_unrecognized', '官方日期格式不受支持');
    const date = `${m[1] ?? inheritedYear}-${String(m[2] ?? inheritedMonth).padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (!isoDate(date) || date < `${year - 1}-12-01` || date > `${year}-12-31`) return fail('official_date', '官方日期超出允许的公告年度范围');
    return date;
  }
  function add(date: string, name: string, isOffDay: boolean): void { if (dayMap.has(date)) fail('official_conflict', '官方安排包含冲突或重复日期'); dayMap.set(date, { date, name, isOffDay }); }
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (section[1] !== numeral[index]) return fail('official_unrecognized', '官方年度通知的条目序号不完整');
    const name = holidayName(section[2]);
    for (const n of name.split('、')) { if (allNames.has(n)) fail('official_conflict', '官方节日条目重复'); allNames.add(n); }
    let wording = body.slice(section.index! + section[0].length, sections[index + 1]?.index ?? body.length).replace(/（[^）]{0,120}）|\([^)]{0,120}\)/g, '');
    const holiday = /^((?:\d{4}年)?\d{1,2}月\d{1,2}日)(?:至((?:\d{4}年)?(?:\d{1,2}月)?\d{1,2}日))?放假(?:调休)?(?:(\d{1,2})天)?(?:，共(\d{1,2})天)?(?:，与周末连休)?(?:，不调休)?。/.exec(wording);
    if (!holiday) return fail('official_unrecognized', '官方休假条目出现未支持的表述');
    const start = dateToken(holiday[1]), end = holiday[2] ? dateToken(holiday[2], Number(start.slice(5, 7)), Number(start.slice(0, 4))) : start;
    const length = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
    if (length < 1 || length > 31 || (holiday[3] || holiday[4]) && length !== Number(holiday[3] ?? holiday[4])) return fail('official_conflict', '官方休假日期与天数不一致');
    for (let date = start; date <= end; date = addDay(date)) add(date, name, true);
    wording = wording.slice(holiday[0].length);
    const work = /^((?:(?:\d{4}年)?\d{1,2}月\d{1,2}日)(?:、(?:(?:\d{4}年)?(?:\d{1,2}月)?\d{1,2}日))*)上班。/.exec(wording);
    if (work) { let month: number | undefined; for (const token of work[1].split('、')) { const date = dateToken(token, month); month = Number(date.slice(5, 7)); add(date, name, false); } wording = wording.slice(work[0].length); }
    if (/放假|调休|上班|取消|调整|延期|\d{1,2}月\d{1,2}日/.test(wording)) return fail('official_unrecognized', '官方条目含有未被完整解释的安排');
  }
  if (allNames.size !== HOLIDAYS.length || HOLIDAYS.some(n => !allNames.has(n))) return fail('official_unrecognized', '官方年度通知缺少全国节假日');
  return { title, noticeNumber: number[0], publishedDate, days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
function sameDays(a: HolidayDay[], b: HolidayDay[], names = true): boolean { return a.length === b.length && a.every((day, i) => day.date === b[i].date && day.isOffDay === b[i].isOffDay && (!names || day.name === b[i].name)); }
function baselineMatches(doc: HolidayDocument): boolean {
  const baseline = CHINESE_HOLIDAY_YEARS[doc.year]; if (!baseline) return false;
  // Named-day fingerprints of the two existing verified fixtures. These are
  // immutable fallback anchors, never a table that needs adding future years.
  const namedBaselineHashes: Record<number, string> = { 2025: 'd8cdfddd2c1c5de933c3747e0da742263aa572ff31a2438e89cde868dec9d72e', 2026: '72a52e957d6b4aaf7290681c75f59edd4d7bef596a3bb4ee260eeaf2c4271b4c' };
  if (sha(JSON.stringify(doc.days)) !== namedBaselineHashes[doc.year]) return false;
  const days: HolidayDay[] = [];
  for (const [start, end] of baseline.holidayRanges) for (let date = start; date <= end; date = addDay(date)) days.push({ date, isOffDay: true, name: '' });
  for (const date of baseline.makeupWorkdays) days.push({ date, isOffDay: false, name: '' });
  return sameDays(doc.days, days.sort((a, b) => a.date.localeCompare(b.date)), false);
}
export function emptyChineseHolidayCache(): ChineseHolidayCache { return { version: 1, years: {}, pending: {}, papers: {}, http: {}, origins: {} }; }
function candidateValid(value: unknown, year: number): value is ChineseHolidayCandidate {
  if (!record(value) || value.year !== year || value.sourceUrl !== machineUrl(year) || typeof value.sourceBody !== 'string' || typeof value.sourceHash !== 'string' || value.sourceHash !== sha(value.sourceBody) || !timestamp(value.fetchedAt)) return false;
  parseChineseHolidayDocument(value.sourceBody, year); return true;
}
function evidenceValid(value: unknown, year: number, today: string): value is OfficialHolidayEvidence {
  if (!record(value) || !isOfficialHolidayPaperUrl(value.url) || typeof value.text !== 'string' || Buffer.byteLength(value.text) > CHINESE_HOLIDAY_REFRESH_LIMITS.officialBytes || value.sha256 !== sha(value.text) || typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) || !timestamp(value.fetchedAt)) return false;
  const parsed = parseOfficialChineseHolidayPaper(value.text, year, today);
  return parsed.title === value.title && parsed.noticeNumber === value.noticeNumber && parsed.publishedDate === value.publishedDate;
}
function verifyProof(doc: HolidayDocument, proofs: OfficialHolidayEvidence[], sourceHash: string, today: string): void {
  if (proofs.length !== doc.papers.length || proofs.some(p => !doc.papers.includes(p.url) || p.sourceHash !== sourceHash) || new Set(proofs.map(p => p.url)).size !== proofs.length) fail('official_mismatch', '官方证据与机器源引用不匹配');
  // Multiple conflicting annual notices and unsupported amendments require review.
  const days = new Map<string, HolidayDay>();
  for (const proof of proofs) for (const day of parseOfficialChineseHolidayPaper(proof.text, doc.year, today).days) { const prev = days.get(day.date); if (prev && (prev.name !== day.name || prev.isOffDay !== day.isOffDay)) fail('official_conflict', '多份官方通知的安排互相冲突'); days.set(day.date, day); }
  if (!sameDays(doc.days, [...days.values()].sort((a, b) => a.date.localeCompare(b.date)))) fail('official_mismatch', '机器源与官方通知逐日核对不一致，已保留旧数据');
}
/** Revalidates persisted proof before any cached year can affect date rules. */
export function validateChineseHolidayCache(raw: unknown, now = new Date()): ChineseHolidayCache {
  if (!record(raw) || raw.version !== 1 || !['years', 'pending', 'papers', 'http', 'origins'].every(k => record(raw[k])) || raw.lastAttemptAt !== undefined && !timestamp(raw.lastAttemptAt)) return fail('invalid_cache', '节假日缓存结构无效');
  const today = shanghaiDate(now), cache = structuredClone(raw) as unknown as ChineseHolidayCache;
  for (const collection of [cache.years, cache.pending]) {
    if (Object.keys(collection).length > 101) fail('invalid_cache', '节假日缓存年度过多');
    for (const [key, item] of Object.entries(collection)) if (!/^\d{4}$/.test(key) || !yearOK(Number(key)) || !candidateValid(item, Number(key))) fail('invalid_cache', '节假日缓存条目或哈希无效');
  }
  for (const item of Object.values(cache.years)) {
    const doc = parseChineseHolidayDocument(item.sourceBody, item.year);
    if (!doc.days.length || !timestamp(item.lastSuccessAt) || !Array.isArray(item.officialEvidence)) fail('invalid_cache', '节假日缓存缺少核验信息');
    if (item.verification === 'builtin-baseline') { if (!baselineMatches(doc) || item.officialEvidence.length !== 0) fail('invalid_cache', '内置已核验基线不匹配'); }
    else if (item.verification === 'machine-source') { if (item.officialEvidence.length !== 0) fail('invalid_cache', '机器源缓存不得携带运行时官方证据'); }
    else if (item.verification === 'official-paper') { if (item.officialEvidence.some(p => !evidenceValid(p, item.year, today))) fail('invalid_cache', '缓存官方证据无效'); verifyProof(doc, item.officialEvidence, item.sourceHash, today); }
    else fail('invalid_cache', '节假日缓存核验类型无效');
  }
  if (Object.keys(cache.papers).length > 303 || Object.keys(cache.http).length > 500 || Object.keys(cache.origins).length > 100) fail('invalid_cache', '节假日缓存状态过大');
  for (const [key, evidence] of Object.entries(cache.papers)) {
    const match = /^(\d{4}):(https:\/\/.*)$/.exec(key);
    if (!match || !yearOK(Number(match[1])) || evidence.url !== match[2] || !evidenceValid(evidence, Number(match[1]), today)) fail('invalid_cache', '缓存公告证据无效');
  }
  for (const [url, state] of Object.entries(cache.http)) {
    if (!(url.startsWith(CHINESE_HOLIDAY_SOURCE) && /^\d{4}\.json$/.test(url.slice(CHINESE_HOLIDAY_SOURCE.length)) || isOfficialHolidayPaperUrl(url)) || !record(state)) fail('invalid_cache', '缓存请求状态无效');
    for (const field of ['lastAttemptAt', 'lastSuccessAt'] as const) if (state[field] !== undefined && !timestamp(state[field])) fail('invalid_cache', '缓存请求时间无效');
    if (state.bodyHash !== undefined && (typeof state.bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(state.bodyHash))) fail('invalid_cache', '缓存响应哈希无效');
    for (const field of ['etag', 'lastModified'] as const) if (state[field] !== undefined && (typeof state[field] !== 'string' || state[field]!.length > 1024 || /[\r\n]/.test(state[field]!))) fail('invalid_cache', '缓存响应标记无效');
  }
  for (const [origin, state] of Object.entries(cache.origins)) {
    let valid = false; try { const u = new URL(origin); valid = u.origin === origin && u.protocol === 'https:' && (u.hostname === 'raw.githubusercontent.com' || u.hostname === 'gov.cn' || u.hostname.endsWith('.gov.cn')) && !u.port; } catch { /* rejected below */ }
    if (!valid || !record(state) || state.blocked !== undefined && typeof state.blocked !== 'boolean' || [state.blockedAt, state.retryAt].some(v => v !== undefined && !timestamp(v))) fail('invalid_cache', '缓存来源冷却状态无效');
  }
  return cache;
}
function retryTime(value: string | undefined, now: Date): string {
  const defaultTime = now.getTime() + 86400000;
  const parsed = value && /^\d+$/.test(value) ? now.getTime() + Number(value) * 1000 : value ? Date.parse(value) : NaN;
  return new Date(Number.isFinite(parsed) && parsed > now.getTime() && parsed <= 8640000000000000 ? parsed : defaultTime).toISOString();
}
function errorMessage(error: unknown): { code: string; message: string } { return error instanceof HolidaySourceError ? { code: error.code, message: error.message } : { code: 'fetch_failed', message: '节假日来源读取失败，已保留最近核验数据' }; }
export async function refreshChineseHolidays(options: ChineseHolidayRefreshOptions = {}): Promise<ChineseHolidayRefreshOutput> {
  const now = options.now ?? new Date(); if (!Number.isFinite(now.getTime())) throw new RangeError('无效检查时间');
  const nowISO = now.toISOString(), today = shanghaiDate(now), current = Number(today.slice(0, 4));
  const years = options.years ?? [current - 1, current, current + 1];
  if (!years.length || years.length > 3 || new Set(years).size !== years.length || years.some(y => !yearOK(y))) throw new RangeError('一次只能检查一至三个不同年度');
  const cache = options.cache === undefined ? emptyChineseHolidayCache() : validateChineseHolidayCache(options.cache, now);
  const fetcher: HolidayFetcher = options.fetcher ?? safeCalendarFetch;
  const results: ChineseHolidayRefreshResult[] = [], requests = { machine: 0, official: 0 };
  cache.lastAttemptAt = nowISO;
  async function request(url: string, kind: 'machine' | 'official', body?: string): Promise<string> {
    const origin = new URL(url).origin, gate = cache.origins[origin];
    if (gate?.blocked) fail('origin_blocked', '来源已返回 403，已停止该来源自动重试');
    if (gate?.retryAt && gate.retryAt > nowISO) fail('rate_limited', '来源要求稍后重试，冷却期间未发送请求');
    if (requests[kind] >= (kind === 'machine' ? CHINESE_HOLIDAY_REFRESH_LIMITS.machineRequests : CHINESE_HOLIDAY_REFRESH_LIMITS.officialRequests)) fail('request_budget', '本次官方核验请求预算已用完，等待下次检查');
    const state = cache.http[url] ?? {}, headers: Record<string, string> = { Accept: kind === 'machine' ? 'application/json' : 'text/html' };
    if (body !== undefined && state.bodyHash === sha(body) && state.etag) headers['If-None-Match'] = state.etag;
    if (body !== undefined && state.bodyHash === sha(body) && state.lastModified) headers['If-Modified-Since'] = state.lastModified;
    requests[kind]++; cache.http[url] = { ...state, lastAttemptAt: nowISO };
    const response = await fetcher(url, { maxBytes: kind === 'machine' ? CHINESE_HOLIDAY_REFRESH_LIMITS.machineBytes : CHINESE_HOLIDAY_REFRESH_LIMITS.officialBytes, timeoutMs: 15000, headers, maxRedirects: 0 });
    const responseHeaders = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (response.status === 403) { cache.origins[origin] = { ...gate, blocked: true, blockedAt: nowISO }; fail('origin_blocked', '来源返回 403，已持久停止该来源自动重试'); }
    if (response.status === 429 || response.status === 503 && responseHeaders['retry-after']) { cache.origins[origin] = { ...gate, retryAt: retryTime(responseHeaders['retry-after'], now) }; fail('rate_limited', '来源限流，已按 Retry-After 进入冷却'); }
    if (response.status === 304 && body !== undefined && state.bodyHash === sha(body)) { cache.http[url].lastSuccessAt = nowISO; return body; }
    if (response.status !== 200) fail('http_error', `节假日来源返回 HTTP ${response.status}，已保留最近核验数据`);
    if (typeof response.text !== 'string' || Buffer.byteLength(response.text) > (kind === 'machine' ? CHINESE_HOLIDAY_REFRESH_LIMITS.machineBytes : CHINESE_HOLIDAY_REFRESH_LIMITS.officialBytes)) fail('oversized_response', '节假日来源响应大小无效');
    const next = { ...cache.http[url], lastSuccessAt: nowISO, bodyHash: sha(response.text) };
    for (const [field, name] of [['etag', 'etag'], ['lastModified', 'last-modified']] as const) { const value = responseHeaders[name]; if (value && value.length <= 1024 && !/[\r\n]/.test(value)) next[field] = value; else delete next[field]; }
    cache.http[url] = next; return response.text;
  }
  for (const year of years) {
    const previous = cache.years[year], result: ChineseHolidayRefreshResult = { year, status: 'error', message: '', lastAttemptAt: nowISO, ...(previous ? { lastSuccessAt: previous.lastSuccessAt } : {}) };
    try {
      const sourceUrl = machineUrl(year), old = cache.pending[year] ?? previous;
      const sourceBody = await request(sourceUrl, 'machine', old?.sourceBody), doc = parseChineseHolidayDocument(sourceBody, year), sourceHash = sha(sourceBody);
      if (doc.days.length === 0) {
        if (previous || CHINESE_HOLIDAY_YEARS[year] || old && parseChineseHolidayDocument(old.sourceBody, year).days.length) fail('withdrawal_suspected', '已发布年度的来源变为空，疑似撤回；已保留旧安排');
        if (year <= current) fail('empty_published_year', '当前或过去年度缺少官方发布数据');
        delete cache.pending[year]; result.status = 'unpublished'; result.message = '该未来年度尚未发布，不推断法定调休';
      } else {
        const candidate: ChineseHolidayCandidate = { year, sourceUrl, sourceHash, sourceBody, fetchedAt: nowISO };
        cache.pending[year] = candidate;
        let verified: VerifiedChineseHolidayYear;
        // Never make an official-network request here. The machine document is
        // schema/hash validated and cached as the only runtime source. The
        // gov.cn URLs in `papers` are attribution metadata only.
        verified = baselineMatches(doc)
          ? { ...candidate, verification: 'builtin-baseline', officialEvidence: [], lastSuccessAt: nowISO }
          : { ...candidate, verification: 'machine-source', officialEvidence: [], lastSuccessAt: nowISO };
        cache.years[year] = verified; delete cache.pending[year]; result.status = previous?.sourceHash === sourceHash ? 'unchanged' : 'updated'; result.lastSuccessAt = nowISO; result.message = verified.verification === 'builtin-baseline' ? '已与内置核验基线逐日比对一致' : '已从机器源读取并缓存；官方出处仅作静态说明';
      }
    } catch (error) {
      const detail = errorMessage(error); Object.assign(result, detail);
      const gates = [cache.origins[new URL(machineUrl(year)).origin], ...((cache.pending[year] ? parseChineseHolidayDocument(cache.pending[year].sourceBody, year).papers : []).map(url => cache.origins[new URL(url).origin]))].filter(Boolean);
      if (detail.code === 'origin_blocked') { result.status = 'blocked'; result.blocked = true; }
      else if (detail.code === 'rate_limited' || detail.code === 'request_budget') { result.status = 'deferred'; result.retryAt = gates.map(g => g?.retryAt).filter((v): v is string => !!v).sort().at(-1); }
      else result.status = cache.pending[year] && !previous ? 'pending' : 'error';
    }
    results.push(result);
  }
  return { cache, results, calendarYears: chineseHolidayCalendarYears(cache, now), requests };
}
/** Build complete calendar years, applying a following notice's December exceptions. */
export function chineseHolidayCalendarYears(raw: unknown, now = new Date()): ChineseHolidayYear[] {
  const cache = validateChineseHolidayCache(raw, now), notices = Object.values(cache.years).sort((a, b) => a.year - b.year);
  const fullYears = new Set([...Object.keys(CHINESE_HOLIDAY_YEARS).map(Number), ...notices.map(v => v.year)]);
  const output: ChineseHolidayYear[] = [];
  for (const year of [...fullYears].sort()) {
    const ownNotice = cache.years[year], nextNotice = cache.years[year + 1];
    if (!ownNotice && !nextNotice) continue; // Untouched baselines stay in the immutable built-in table.
    const base = CHINESE_HOLIDAY_YEARS[year], dates = new Map<string, boolean>();
    if (!ownNotice && base) { for (const [start, end] of base.holidayRanges) for (let date = start; date <= end; date = addDay(date)) dates.set(date, true); for (const date of base.makeupWorkdays) dates.set(date, false); }
    const sourceUrls = new Set<string>(!ownNotice ? base?.sourceUrls ?? [] : []);
    for (const notice of [ownNotice, nextNotice]) if (notice) {
      const doc = parseChineseHolidayDocument(notice.sourceBody, notice.year);
      const relevant = doc.days.filter(d => Number(d.date.slice(0, 4)) === year);
      if (relevant.length) { for (const day of relevant) dates.set(day.date, day.isOffDay); for (const url of notice.verification === 'builtin-baseline' ? CHINESE_HOLIDAY_YEARS[notice.year].sourceUrls : doc.papers) sourceUrls.add(url); sourceUrls.add(notice.sourceUrl); }
    }
    const ordered = [...dates.entries()].sort(([a], [b]) => a.localeCompare(b)), holidayRanges: [string, string][] = [], makeupWorkdays: string[] = [];
    for (const [date, off] of ordered) { if (!off) { makeupWorkdays.push(date); continue; } const last = holidayRanges.at(-1); if (last && addDay(last[1]) === date) last[1] = date; else holidayRanges.push([date, date]); }
    const evidence = ownNotice?.officialEvidence[0];
    // Machine-source years intentionally have no runtime official proof. Keep
    // the metadata required by the calendar snapshot without inventing an
    // official notice number or contacting its gov.cn attribution URL.
    const publishedDate = evidence?.publishedDate ?? base?.publishedDate ?? ownNotice?.lastSuccessAt.slice(0, 10) ?? nextNotice?.lastSuccessAt.slice(0, 10);
    const noticeNumber = evidence?.noticeNumber ?? base?.noticeNumber ?? `机器源 ${ownNotice?.year ?? nextNotice?.year}`;
    if (!publishedDate) continue;
    output.push({ year, publishedDate, noticeNumber, sourceUrls: [...sourceUrls], holidayRanges, makeupWorkdays });
  }
  return output;
}
export function installChineseHolidayCache(raw: unknown, now = new Date()): void { installVerifiedChineseHolidayYears(chineseHolidayCalendarYears(raw, now)); }
