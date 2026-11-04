/**
 * Who took a call, in words. Most calls on a PBX are answered on phones with no CRM account, so the
 * extension is the only name they have.
 */
import type { CallDto } from '@crm/shared';

/**
 * An inbound call that was not answered only rang that extension, which is not the same as being
 * handled by it. An outbound call's extension placed it, so it counts whatever the outcome.
 */
export function extensionHandler(
  extension: unknown,
  direction: unknown,
  status: unknown,
): string | null {
  if (typeof extension !== 'string' || extension === '') return null;
  if (direction === 'inbound' && status !== 'completed') return null;
  return `Extension ${extension}`;
}

export function callHandler(
  call: Pick<CallDto, 'user' | 'extension' | 'direction' | 'status'>,
): string | null {
  return call.user?.name ?? extensionHandler(call.extension, call.direction, call.status);
}
