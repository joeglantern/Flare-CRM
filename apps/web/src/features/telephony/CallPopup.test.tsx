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

  it('shows the write-up for a call that only arrived at its end', () => {
    renderWithProviders(<CallPopupHost />);
    act(() => {
      useCallStore.getState().onLogged({
        at: '2026-09-05T12:02:06Z',
        callId: CALL_ID,
        pbxCallId: 'late',
        status: 'completed',
        talkDurationSec: 30,
        totalDurationSec: 40,
        contactId: null,
        suggestFollowUp: false,
        recordingStatus: 'none',
        direction: 'inbound',
        partyDisplay: '0745 150974',
      });
    });
    expect(screen.getByText('Call ended')).toBeInTheDocument();
    expect(screen.getByText('0745 150974')).toBeInTheDocument();
  });

  it('shows the next card after the agent skips one, and never reopens the skipped one', () => {
    renderWithProviders(<CallPopupHost />);
    const logged = (pbxCallId: string, partyDisplay: string) => ({
      at: '2026-10-21T18:00:00Z',
      callId: CALL_ID,
      pbxCallId,
      status: 'completed' as const,
      talkDurationSec: 5,
      totalDurationSec: 9,
      contactId: null,
      suggestFollowUp: false,
      recordingStatus: 'stored' as const,
      direction: 'inbound' as const,
      partyDisplay,
    });
    act(() => {
      useCallStore.getState().onLogged(logged('a', 'First caller'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByText('First caller')).not.toBeInTheDocument();

    act(() => {
      // offered again by the pending check: stays closed
      useCallStore.getState().onLogged(logged('a', 'First caller'));
      useCallStore.getState().onLogged(logged('b', 'Second caller'));
    });
    expect(screen.queryByText('First caller')).not.toBeInTheDocument();
    expect(screen.getByText('Second caller')).toBeInTheDocument();
  });
});
