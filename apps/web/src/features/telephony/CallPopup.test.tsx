import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { CallPopupHost } from './CallPopup';
import { useCallStore } from './call-store';

const CALL_ID = '01a00000-0000-7000-8000-00000000c001';

describe('CallPopupHost', () => {
  beforeEach(() => {
    useCallStore.getState().reset();
    useCallStore.setState({ closedIds: [] });
  });

  it('says the call page is opening between the hangup and the write-up', () => {
    renderWithProviders(<CallPopupHost />);
    act(() => {
      const store = useCallStore.getState();
      store.onDialing({
        at: '2026-09-05T12:00:00Z',
        callId: CALL_ID,
        pbxCallId: 'p1',
        callee: '+254745150974',
      });
      store.onEnded({
        at: '2026-09-05T12:01:00Z',
        callId: CALL_ID,
        pbxCallId: 'p1',
        endedAt: '2026-09-05T12:01:00Z',
      });
    });
    expect(screen.getByText('Opening the call to write it up...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Opening the call to write it up...')).not.toBeInTheDocument();
    // Closed here, so the pending check will not open it again.
    expect(useCallStore.getState().claimWriteUp('p1')).toBe(false);
  });
});
