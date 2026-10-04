/**
 * Settings, Telephony: where the test call is explained. The button is the same one the Calls
 * pages carry, so there is one way to rehearse the popup, not two.
 */
import { Panel } from '@/components/entity/EntityHeader';
import { TestCallButton } from './TestCallButton';

export function PopupPreviewPanel() {
  return (
    <Panel
      title="Test the call popup"
      note="Only you see it. Nothing is logged, and no phone rings."
    >
      <div className="flex flex-wrap items-center gap-3">
        <TestCallButton />
        <span className="text-sm text-muted">
          Shows the popup a call from any number would bring up. Also on the Calls and Live calls
          pages.
        </span>
      </div>
    </Panel>
  );
}
