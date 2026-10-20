import type { OwnerContact } from '@crm/shared';
import { useSettings } from './settings';

/**
 * Who to ask for help here: the person an admin entered in Settings, Support contact. Null until
 * one is set, and then the screens say "ask your administrator": the contact the plan names is
 * the provider, whose name and address are not for the people using the CRM.
 */
export function useSupportContact(): OwnerContact | null {
  return useSettings().supportContact;
}
