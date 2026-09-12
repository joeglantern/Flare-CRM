/**
 * How long the console waits for a stack to answer a question it asked over the link.
 *
 * This has to stay comfortably under the server's `connectionTimeout` (app.ts), which is a socket
 * inactivity timer: while a handler sits waiting for a stack, no bytes move, so the clock is
 * running. Set the two the same and they race. The socket is destroyed at the moment the handler
 * finally answers, the reply can never be written, and the owner sees a bare 502 from the proxy
 * instead of the plain "it did not answer" this code took care to produce.
 *
 * Eight seconds against ten is the margin. A stack that is well answers in milliseconds; one that
 * needs longer than this is not going to be rescued by a couple more.
 */
export const STACK_ANSWER_MS = 8_000;

/** What an owner is told when it runs out. Kept beside the number so the two cannot disagree. */
export const STACK_SILENT_MESSAGE = 'The stack did not answer in eight seconds.';
