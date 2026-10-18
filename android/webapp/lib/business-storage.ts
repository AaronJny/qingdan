/** Platform boundary for the shared language runtime. Android keeps its existing
 * persistent WebView storage; its QingdanLocal database bridge is separate. */
export function businessStorage(): Storage {
  return typeof window === 'undefined' ? globalThis.localStorage : window.localStorage;
}
