/**
 * MinimizedDialogsContext — centralized manager for minimized dialog pills.
 *
 * Instead of each dialog rendering its own `fixed bottom-4 right-4` pill
 * (which causes overlaps when multiple dialogs are minimized), dialogs
 * register their minimized state here and the {@link MinimizedDialogsTray}
 * renders them as a non-overlapping vertical stack in the bottom-right.
 */

import { createContext, useContext, useCallback, useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { useBreakpoint } from '../hooks/useBreakpoint';

// ── types ────────────────────────────────────────────────────────────────────

export interface MinimizedDialogEntry {
    /** Unique key for this dialog (e.g. 'generate-task', 'new-chat'). */
    id: string;
    /** Emoji or short icon string shown in the pill. */
    icon: string;
    /** Short label (e.g. "Generate Task", "New Chat"). */
    label: string;
    /** Optional preview text (truncated prompt, file name, etc.). */
    preview?: string;
    /** Called to restore (un-minimize) the dialog. */
    onRestore: () => void;
    /** If provided, a ✕ close button is shown. */
    onClose?: () => void;
    /** Optional extra ReactNode rendered after the label (e.g. a Spinner). */
    extra?: ReactNode;
}

interface MinimizedDialogsContextValue {
    /** Add or update an entry. Only triggers re-render when id-list or display data changes. */
    register: (entry: MinimizedDialogEntry) => void;
    /** Remove an entry by id. */
    unregister: (id: string) => void;
    /** Current visible entries. */
    entries: MinimizedDialogEntry[];
}

const MinimizedDialogsContext = createContext<MinimizedDialogsContextValue>({
    register: () => {},
    unregister: () => {},
    entries: [],
});

// ── provider ─────────────────────────────────────────────────────────────────

export function MinimizedDialogsProvider({ children }: { children: ReactNode }) {
    // State tracks display-relevant data for rendering.
    const [entries, setEntries] = useState<MinimizedDialogEntry[]>([]);
    // Ref holds the latest full entries so register can do cheap identity checks.
    const entriesRef = useRef<Map<string, MinimizedDialogEntry>>(new Map());

    const register = useCallback((entry: MinimizedDialogEntry) => {
        const map = entriesRef.current;
        const existing = map.get(entry.id);

        // Always update the ref with latest entry (callbacks may have changed)
        map.set(entry.id, entry);

        // Only update React state if this is a new entry or display-relevant data changed
        const displayChanged = !existing
            || existing.icon !== entry.icon
            || existing.label !== entry.label
            || existing.preview !== entry.preview
            || existing.extra !== entry.extra
            || (!!existing.onClose) !== (!!entry.onClose);

        if (displayChanged) {
            setEntries(Array.from(map.values()));
        }
    }, []);

    const unregister = useCallback((id: string) => {
        const map = entriesRef.current;
        if (map.has(id)) {
            map.delete(id);
            setEntries(Array.from(map.values()));
        }
    }, []);

    const value = useMemo(() => ({ register, unregister, entries }), [register, unregister, entries]);

    return (
        <MinimizedDialogsContext.Provider value={value}>
            {children}
        </MinimizedDialogsContext.Provider>
    );
}

// ── hook ─────────────────────────────────────────────────────────────────────

/**
 * Register a minimized dialog entry when `entry` is non-null; unregister when null.
 * Uses stable identity checks to avoid infinite render loops.
 *
 * @example
 * useMinimizedDialog(minimized ? { id: 'my-dialog', icon: '✨', label: 'My Dialog', onRestore } : null);
 */
export function useMinimizedDialog(entry: MinimizedDialogEntry | null): void {
    const { register, unregister } = useContext(MinimizedDialogsContext);
    const prevIdRef = useRef<string | null>(null);

    // Runs on every render to keep callbacks fresh, but register is cheap
    // when display data hasn't changed (skips setState).
    useEffect(() => {
        if (entry) {
            register(entry);
            prevIdRef.current = entry.id;
        } else if (prevIdRef.current) {
            unregister(prevIdRef.current);
            prevIdRef.current = null;
        }
    });

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (prevIdRef.current) {
                unregister(prevIdRef.current);
            }
        };
    }, [unregister]);
}

// ── tray component ───────────────────────────────────────────────────────────

export function MinimizedDialogsTray() {
    const { entries } = useContext(MinimizedDialogsContext);
    const { isMobile } = useBreakpoint();

    if (entries.length === 0) return null;

    const bottomBase = isMobile ? 64 : 16; // bottom-16 (64px) for mobile, bottom-4 (16px) for desktop

    return ReactDOM.createPortal(
        <div
            data-testid="minimized-dialogs-tray"
            className="fixed right-4 z-[10001] flex flex-col-reverse gap-2 pointer-events-none"
            style={{ bottom: `${bottomBase}px` }}
        >
            {entries.map(entry => (
                <div
                    key={entry.id}
                    data-testid={`minimized-pill-${entry.id}`}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] cursor-pointer hover:shadow-xl transition-shadow pointer-events-auto select-none"
                    onClick={entry.onRestore}
                >
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        {entry.icon} {entry.label}
                    </span>
                    {entry.preview && (
                        <span className="text-xs text-[#848484] max-w-[160px] truncate">
                            ▪ &ldquo;{entry.preview}&rdquo;
                        </span>
                    )}
                    {entry.extra}
                    <span
                        className="ml-1 text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                        onClick={e => { e.stopPropagation(); entry.onRestore(); }}
                    >
                        Restore
                    </span>
                    {entry.onClose && (
                        <button
                            className="ml-1 text-xs text-[#848484] hover:text-red-500 focus:outline-none"
                            onClick={e => { e.stopPropagation(); entry.onClose!(); }}
                            aria-label={`Close ${entry.label}`}
                            title="Close"
                        >
                            ✕
                        </button>
                    )}
                </div>
            ))}
        </div>,
        document.body,
    );
}
