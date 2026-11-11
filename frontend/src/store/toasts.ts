import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'event';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Deep-link target rendered as "Open". */
  href?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push(toast) {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), toast.kind === 'error' ? 6000 : 4200);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export function toast(title: string, kind: ToastKind = 'success', body?: string) {
  useToasts.getState().push({ title, kind, body });
}
