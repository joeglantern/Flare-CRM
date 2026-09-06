/**
 * SessionExpiredDialog (Component Inventory · Hooks and providers). Warns before the idle sign-out
 * so unsaved form state is never lost silently; the sign-out itself is handled by
 * AuthenticatedRuntime, which owns the timer.
 */
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';
import { useSessionWarning } from '@/lib/session-warning';
import { useSettings } from '@/providers/settings';

export function SessionExpiredDialog() {
  const { warning, setWarning } = useSessionWarning();
  const settings = useSettings();
  return (
    <Dialog
      open={warning}
      onOpenChange={setWarning}
      title="Still there?"
      width={420}
      footer={
        <Button
          variant="primary"
          onClick={() => {
            setWarning(false);
          }}
        >
          Keep me signed in
        </Button>
      }
    >
      <p className="flex items-start gap-2.5 text-base text-muted">
        <Clock size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <span>
          You will be signed out after {settings.security.sessionIdleMinutes} minutes of inactivity.
          Anything you have typed stays on screen; sign in again in the same tab to save it.
        </span>
      </p>
    </Dialog>
  );
}
