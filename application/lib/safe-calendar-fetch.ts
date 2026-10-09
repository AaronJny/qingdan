/** Server-only public HTTPS fetch. DNS is checked once per hop, then pinned to
 * the TLS socket; redirects repeat the same validation. Never include URLs,
 * response bodies or native exception text in errors (ICS URLs can be secrets). */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
export class CalendarFetchError extends Error {
  constructor(public code: 'URL'|'ADDRESS'|'NETWORK'|'TIMEOUT'|'TOO_LARGE'|'REDIRECT'|'ENCODING') {
    super(({ URL: '仅支持公开 HTTPS 日历地址（443端口），不能包含登录密码。', ADDRESS: '日历地址指向非公开网络，已拒绝连接。', NETWORK: '日历来源暂时无法连接。', TIMEOUT: '日历来源连接超时。', TOO_LARGE: '日历来源超过大小限制。', REDIRECT: '日历来源重定向不受支持。', ENCODING: '日历来源返回了不支持的压缩格式。' })[code]);
    this.name = 'CalendarFetchError';
  }
}
export function calendarUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 4096 || /[\s\x00-\x1f\x7f]/.test(input)) throw new CalendarFetchError('URL');
  let url: URL; try { url = new URL(input.replace(/^webcal:/i, 'https:')); } catch { throw new CalendarFetchError('URL'); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash || !url.hostname || url.hostname.endsWith('.')) throw new CalendarFetchError('URL');
  return url;
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    // Only ordinary global unicast. Reject mapped/compatible IPv4, transition,
    // documentation, Teredo, ORCHID, link-local, ULA and multicast addresses.
    if (address.includes('.') || address.includes('%')) return false;
    const [first, second = '0'] = address.toLowerCase().split(':');
    const a = parseInt(first, 16), b = parseInt(second || '0', 16);
    return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) && !(a === 0x3fff && b <= 0xfff);
  }
  return false;
}
export type CalendarHttpResult = { status: number; text: string; headers: Record<string,string> };
export type CalendarFetchOptions = { maxBytes?: number; timeoutMs?: number; headers?: Record<string,string>; signal?: AbortSignal; maxRedirects?: number };
export type CalendarFetcher = (url: string, options?: CalendarFetchOptions) => Promise<CalendarHttpResult>;
export async function publicAddress(host: string, resolver = lookup): Promise<{ address:string; family:number }> {
  const hostname = host.replace(/^\[|\]$/g, '');
  let addresses: { address:string; family:number }[];
  try { addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await resolver(hostname, {all:true,verbatim:true}); } catch { throw new CalendarFetchError('NETWORK'); }
  if (!addresses.length || addresses.some(row => !isPublicAddress(row.address))) throw new CalendarFetchError('ADDRESS');
  return addresses[0];
}
export function createSafeCalendarFetcher(resolveHost=publicAddress,requestImpl=request):CalendarFetcher{return async (input, options = {}) => {
  const maxBytes = Math.min(options.maxBytes ?? 2 * 1024 * 1024, 2 * 1024 * 1024);
  const timeout = Math.min(options.timeoutMs ?? 12000, 20000);
  const deadline = Date.now() + timeout;
  const maxRedirects=Math.max(0,Math.min(3,options.maxRedirects??3));
  let url = calendarUrl(input);
  if(options.signal?.aborted)throw new CalendarFetchError('NETWORK');
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pinned = await Promise.race([resolveHost(url.hostname), new Promise<never>((_, reject) => { timer=setTimeout(()=>reject(new CalendarFetchError('TIMEOUT')),Math.max(1,deadline-Date.now())); })]).finally(()=>clearTimeout(timer));
    if(options.signal?.aborted)throw new CalendarFetchError('NETWORK');
    if (Date.now() >= deadline) throw new CalendarFetchError('TIMEOUT');
    const result = await new Promise<CalendarHttpResult & {location?:string}>((resolve,reject) => {
      let settled=false;
      const headers: Record<string,string> = {'Accept':'text/calendar, application/json, text/html;q=0.8','Accept-Encoding':'identity','User-Agent':'Qingdan-Calendar/1.0'};
      for (const [key,value] of Object.entries(options.headers || {})) if (['if-none-match','if-modified-since'].includes(key.toLowerCase()) && value.length < 1024 && !/[\r\n]/.test(value)) headers[key] = value;
      const req=requestImpl(url,{method:'GET',agent:false,headers,maxHeaderSize:16384,lookup:((_host:unknown,opts:any,callback:any)=>opts.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family)) as any},res=>{
        const responseHeaders: Record<string,string>={};
        for (const key of ['etag','last-modified','retry-after','content-type']) if (typeof res.headers[key] === 'string') responseHeaders[key]=res.headers[key] as string;
        const status=res.statusCode || 0;
        if (status !== 200) { settled=true;clearTimeout(timer);res.destroy();resolve({status,text:'',headers:responseHeaders,location:typeof res.headers.location==='string'?res.headers.location:undefined});return; }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { req.destroy(new CalendarFetchError('ENCODING'));return; }
        if (Number(res.headers['content-length'] || 0)>maxBytes) { req.destroy(new CalendarFetchError('TOO_LARGE'));return; }
        const chunks:Buffer[]=[];let size=0;
        res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){req.destroy(new CalendarFetchError('TOO_LARGE'));return;}chunks.push(chunk)});
        res.on('error',()=>fail(new CalendarFetchError('NETWORK')));
        res.on('end',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve({status,text:Buffer.concat(chunks).toString('utf8'),headers:responseHeaders})});
      });
      const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timer);reject(error instanceof CalendarFetchError?error:new CalendarFetchError('NETWORK'))};
      req.on('error',fail);
      const abort=()=>req.destroy(new CalendarFetchError('NETWORK'));options.signal?.addEventListener('abort',abort,{once:true});req.on('close',()=>options.signal?.removeEventListener('abort',abort));
      // lookup is pinned and the native TLS verifier continues to validate the
      // original URL's hostname. No proxy environment or pooled socket is used.
      timer=setTimeout(()=>req.destroy(new CalendarFetchError('TIMEOUT')),Math.max(1,deadline-Date.now()));
      req.end();
    });
    if ([301,302,303,307,308].includes(result.status)) {
      if (!result.location || hop===maxRedirects) throw new CalendarFetchError('REDIRECT');
      const next = calendarUrl(new URL(result.location,url).href);
      // Tokens in paths/queries are never forwarded to a different origin.
      if (next.origin!==url.origin) throw new CalendarFetchError('REDIRECT');
      url=next;continue;
    }
    return {status:result.status,text:result.text,headers:result.headers};
  }
  throw new CalendarFetchError('REDIRECT');
};}
export const safeCalendarFetch = createSafeCalendarFetcher();
