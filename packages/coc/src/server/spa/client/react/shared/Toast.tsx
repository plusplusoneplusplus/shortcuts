import { useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';

export interface ToastItem {
    id: string;
    message: string;
    type?: 'success' | 'error' | 'info';
}

export interface ToastProps {
    toasts: ToastItem[];
    removeToast: (id: string) => void;
}

export function useToast() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const addToast = useCallback((message: string, type: ToastItem['type'] = 'info') => {
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => removeToast(id), 3000);
    }, [removeToast]);

    return { toasts, addToast, removeToast };
}

const typeMap = {
    success: 'bg-[#16825d] dark:bg-[#89d185] dark:text-black',
    error: 'bg-[#f14c4c] dark:bg-[#f48771] dark:text-black',
    info: 'bg-[#0078d4]',
};

export function ToastContainer({ toasts, removeToast }: ToastProps) {
    return ReactDOM.createPortal(
        <div className="fixed bottom-5 right-5 z-[10001] flex flex-col gap-2 pointer-events-none">
            {toasts.map(t => (
                <div
                    key={t.id}
                    onClick={() => removeToast(t.id)}
                    className={cn(
                        'px-4 py-2.5 rounded-md text-white text-sm font-medium shadow-lg max-w-sm break-words pointer-events-auto cursor-pointer',
                        'animate-[toast-in_0.3s_ease]',
                        typeMap[t.type ?? 'info']
                    )}
                >
                    {t.message}
                </div>
            ))}
        </div>,
        document.body
    );
}
