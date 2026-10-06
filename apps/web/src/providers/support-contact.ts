import { useEntitlements } from './entitlements';
import { useSettings } from './settings';

/**
 * Who to ask for help here: the person an admin entered in Settings, else the contact the plan
 * names. Used wherever someone is told to "contact" somebody about access; the plan's own renewal
 * and expiry notices keep naming the plan's contact, since that is who renews it.
 */
export function useSupportContact(): ReturnType<typeof useEntitlements>['ownerContact'] {
  const { ownerContact } = useEntitlements();
  return useSettings().supportContact ?? ownerContact;
}
