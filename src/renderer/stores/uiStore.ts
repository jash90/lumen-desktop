import { create } from 'zustand';

/** Local-only UI state (PRD §15): where we are and what to tell the user. */

export type View =
  | { name: 'home' }
  | { name: 'room'; id: string }
  | { name: 'light'; id: string }
  | { name: 'automations' }
  | { name: 'settings' };

export interface Toast {
  id: number;
  message: string;
}

interface UiState {
  view: View;
  toasts: Toast[];
  navigate(view: View): void;
  goHome(): void;
  pushToast(message: string): void;
  dismissToast(id: number): void;
}

let nextToastId = 1;

export const useUiStore = create<UiState>((set) => ({
  view: { name: 'home' },
  toasts: [],

  navigate: (view) => set({ view }),
  goHome: () => set({ view: { name: 'home' } }),

  pushToast: (message) => {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts, { id, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 4_000);
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
