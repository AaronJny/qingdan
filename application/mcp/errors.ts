const messages = {
  CONFLICT: 'The task changed. Read it again before preparing a new operation.',
  DENIED: 'The current desktop agent permission does not allow this operation.',
  NOT_FOUND: 'The task or list is not available within the current permission.',
  INVALID_ARGUMENT: 'The operation arguments were not accepted.',
  UNAVAILABLE: 'The desktop connection or selected server is unavailable. Inspect task state before retrying a write.',
};
export class GatewayError extends Error {
  readonly code: keyof typeof messages;
  constructor(code: unknown) {
    const safeCode = typeof code === 'string' && Object.hasOwn(messages, code) ? code as keyof typeof messages : 'UNAVAILABLE';
    super(messages[safeCode]); this.code = safeCode;
  }
}
