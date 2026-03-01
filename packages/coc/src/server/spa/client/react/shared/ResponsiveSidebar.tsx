import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';
import { useBreakpoint } from '../hooks/useBreakpoint';

const DRAWER_BACKDROP_Z = 9000;
const DRAWER_PANEL_Z = 9001;
const ANIMATION_MS = 200;
const SWIPE_THRESHOLD = 50;
const SWIPE_MAX_DRIFT = 30;

export interface ResponsiveSidebarProps {
    children: ReactNode;
    /** Controls mobile drawer open state. Ignored on tablet/desktop. */
    isOpen: boolean;
    /** Called when the user dismisses the mobile drawer (backdrop tap or swipe). */
    onClose: () => void;
    /** Desktop sidebar width. Default: 320 */
    width?: number;
    /** Tablet sidebar width. Default: 260 */
    tabletWidth?: number;
    /** Extra classes forwarded to the outer element. */
    className?: string;
}

export function ResponsiveSidebar({
    children,
    isOpen,
    onClose,
    width = 320,
    tabletWidth = 260,
    className,
}: ResponsiveSidebarProps) {
    const { isMobile, isTablet } = useBreakpoint();

    if (isMobile) {
        return (
            <MobileDrawer isOpen={isOpen} onClose={onClose} className={className}>
                {children}
            </MobileDrawer>
        );
    }

    const effectiveWidth = isTablet ? tabletWidth : width;

    return (
        <aside
            data-testid="responsive-sidebar"
            className={cn(
                'shrink-0 min-h-0 flex flex-col overflow-hidden',
                'border-r border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-[#f3f3f3] dark:bg-[#252526]',
                'transition-[width,min-width] duration-150 ease-out',
                className
            )}
            style={{ width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth }}
        >
            {children}
        </aside>
    );
}

/* ── Mobile Drawer (portal overlay) ──────────────────────────────────── */

interface MobileDrawerProps {
    children: ReactNode;
    isOpen: boolean;
    onClose: () => void;
    className?: string;
}

function MobileDrawer({ children, isOpen, onClose, className }: MobileDrawerProps) {
    const drawerRef = useRef<HTMLElement>(null);
    const triggerRef = useRef<Element | null>(null);
    const touchState = useRef<{ startX: number; startY: number; startTime: number } | null>(null);

    // Body scroll lock
    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isOpen]);

    // Focus trap: capture trigger, move focus into drawer, restore on close
    useEffect(() => {
        if (isOpen) {
            triggerRef.current = document.activeElement;
            // Defer focus to after portal renders
            const raf = requestAnimationFrame(() => {
                drawerRef.current?.focus();
            });
            return () => cancelAnimationFrame(raf);
        } else if (triggerRef.current instanceof HTMLElement) {
            triggerRef.current.focus();
            triggerRef.current = null;
        }
    }, [isOpen]);

    // Keyboard: trap Tab inside drawer, Escape to close
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
                return;
            }
            if (e.key === 'Tab' && drawerRef.current) {
                const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
                );
                if (focusable.length === 0) {
                    e.preventDefault();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        },
        [onClose]
    );

    // Swipe-to-dismiss touch handlers
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        touchState.current = { startX: touch.clientX, startY: touch.clientY, startTime: Date.now() };
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!touchState.current || !drawerRef.current) return;
        const touch = e.touches[0];
        const deltaX = touch.clientX - touchState.current.startX;
        const deltaY = touch.clientY - touchState.current.startY;

        // Only track horizontal swipes to the left
        if (Math.abs(deltaX) > 10 && Math.abs(deltaY) < SWIPE_MAX_DRIFT) {
            const clampedX = Math.min(0, deltaX);
            drawerRef.current.style.transition = 'none';
            drawerRef.current.style.transform = `translateX(${clampedX}px)`;
        }
    }, []);

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            if (!touchState.current || !drawerRef.current) return;
            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - touchState.current.startX;
            const deltaY = touch.clientY - touchState.current.startY;

            if (deltaX < -SWIPE_THRESHOLD && Math.abs(deltaY) < SWIPE_MAX_DRIFT) {
                onClose();
            } else {
                // Snap back
                drawerRef.current.style.transition = `transform 150ms ease-in-out`;
                drawerRef.current.style.transform = 'translateX(0)';
            }
            touchState.current = null;
        },
        [onClose]
    );

    return ReactDOM.createPortal(
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
            data-testid="sidebar-backdrop"
            className={cn(
                'fixed inset-0 bg-black/50 transition-opacity',
                isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}
            style={{ zIndex: DRAWER_BACKDROP_Z }}
            onClick={onClose}
            onKeyDown={handleKeyDown}
        >
            <aside
                ref={drawerRef}
                data-testid="sidebar-drawer"
                className={cn(
                    'fixed inset-y-0 left-0 w-[85vw] max-w-[360px] flex flex-col overflow-hidden',
                    'bg-[#f3f3f3] dark:bg-[#252526]',
                    'shadow-xl',
                    'transition-transform ease-in-out',
                    isOpen ? 'translate-x-0' : '-translate-x-full',
                    className
                )}
                style={{
                    zIndex: DRAWER_PANEL_Z,
                    transitionDuration: `${ANIMATION_MS}ms`,
                }}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {children}
            </aside>
        </div>,
        document.body
    );
}
