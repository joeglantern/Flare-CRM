/** Idle-session warning flag; the designed dialog subscribes to it (docs/17 section 5). */
import { create } from 'zustand';

export const useSessionWarning = create<{ warning: boolean; setWarning: (v: boolean) => void }>(
  (set) => ({
    warning: false,
    setWarning: (warning) => {
      set({ warning });
    },
  }),
);
