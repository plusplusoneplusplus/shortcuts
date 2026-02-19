/**
 * ToastContext — provides a global addToast function that can be used from anywhere
 * in the component tree, including dialogs that may unmount before the toast expires.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { ToastItem } from '../shared/Toast';

export interface ToastContextValue {
    addToast: (message: string, type?: ToastItem['type']) => void;
    removeToast: (id: string) => void;
    toasts: ToastItem[];
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useGlobalToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useGlobalToast must be used within ToastContext.Provider');
    return ctx;
}

interface ToastProviderProps {
    value: ToastContextValue;
    children: ReactNode;
}

export function ToastProvider({ value, children }: ToastProviderProps) {
    return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
