import{LOCAL_ORIGIN,nativeInfo}from'./storage';
export type LocalUser={userId:string;email:string;displayName:string;fullName:string|null;role:'admin'|'user'};
export class AuthError extends Error{constructor(message:string,public status=400,public code?:string){super(message)}}
export function appMode(){if(location.origin!==LOCAL_ORIGIN)throw new AuthError('本地API不可用于私服账号。',403);return'local' as const}
export async function getLocalUser(_request?:Request):Promise<LocalUser>{appMode();return{userId:nativeInfo().principalId,email:'local@qingdan.invalid',displayName:'本地用户',fullName:'本地用户',role:'admin'}}
export function assertSameOrigin(request:Request){appMode();if(new URL(request.url).origin!==LOCAL_ORIGIN||request.headers.get('origin')!==LOCAL_ORIGIN||request.headers.get('x-qingdan')!=='1'||request.headers.get('sec-fetch-site')==='cross-site')throw new AuthError('本地请求来源不匹配。',403)}
export function csrfTokenForRequest(_request?:Request){appMode();return nativeInfo().csrfToken}
export function assertCsrf(request:Request){assertSameOrigin(request);if(request.headers.get('x-qingdan-csrf')!==nativeInfo().csrfToken)throw new AuthError('本地会话已变化，请重新打开。',403,'CSRF_INVALID')}
