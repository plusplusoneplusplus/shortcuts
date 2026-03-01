/**
 * BottomSheet — reusable bottom sheet overlay for mobile.
 * Portal-rendered, slides up from bottom with drag-to-dismiss.
 */

import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';

export interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    /** Height as percentage of viewport. Default: 60 */
    height?: number;
}

const BACKDROP_Z = 9500;
const DISMISS_THRESHOLD = 100;

export function BottomSheet({ isOpen, onClose, title, children, height = 60 }: BottomSheetProps) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragState = useRef<{ startY: number; currentDelta: number } | null>(null);

    // Body scroll lock
    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isOpen]);

    // Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        dragState.current = { startY: touch.clientY, currentDelta: 0 };
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!dragState.current || !sheetRef.current) return;
        const touch = e.touches[0];
        const delta = Math.max(0, touch.clientY - dragState.current.startY);
        dragState.current.currentDelta = delta;
        sheetRef.current.style.transition = 'none';
        sheetRef.current.style.transform = `translateY(${delta}px)`;
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (!dragState.current || !sheetRef.current) return;
        if (dragState.current.currentDelta > DISMISS_THRESHOLD) {
            onClose();
        } else {
            sheetRef.current.style.transition = 'transform 300ms ease-out';
            sheetRef.current.style.transform = 'translateY(0)';
        }
        dragState.current = null;
    }, [onClose]);

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div
            data-testid="bottomsheet-backdrop"
            className="fixed inset-0 bg-black/40 dark:bg-black/60"
            style={{ zIndex: BACKDROP_Z }}
            onClick={onClose}
        >
            <div
                ref={sheetRef}
                data-testid="bottomsheet-panel"
                className={cn(
                    'fixed bottom-0 left-0 right-0 rounded-t-2xl flex flex-col',
                    'bg-white dark:bg-[#252526]',
                    'shadow-xl',
                    'will-change-transform'
                )}
                style={{
                    zIndex: BACKDROP_Z + 1,
                    maxHeight: `${height}vh`,
                    transform: 'translateY(0)',
                    transition: 'transform 300ms ease-out',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Drag handle */}
                <div
                    data-testid="bottomsheet-drag-handle"
                    className="flex justify-center pt-3 pb-2 cursor-grab"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    <div className="w-10 h-1 rounded-full bg-[#c0c0c0] dark:bg-[#555]" />
                </div>

                {title && (
                    <div className="px-4 pb-2 text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        {title}
                    </div>
                )}

                <div className="overflow-y-auto flex-1">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
