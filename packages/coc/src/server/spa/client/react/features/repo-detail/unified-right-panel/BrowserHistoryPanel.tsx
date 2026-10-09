import { useEffect, useId, useRef, useState } from 'react';
import type { BrowserHistoryResult, BrowserOperationResult, DesktopBrowserHistory } from '../../../shared/file-path/browser-bridge';
import { Dialog } from '../../../ui/Dialog';
import { nativeViewToolbarButton as button } from './NativeViewTab';

const PAGE_SIZE = 50;

/** Bounded desktop queries; persistence and clear confirmation belong to main. */
export function BrowserHistoryPanel({ history, onOpen, onClose }: {
    history: DesktopBrowserHistory;
    onOpen(url: string): void;
    onClose(): void;
}) {
    const [search, setSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [refresh, setRefresh] = useState(0);
    const [result, setResult] = useState<BrowserHistoryResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    const [operationError, setOperationError] = useState<string | null>(null);
    const request = useRef(0);
    const mounted = useRef(false);
    const busy = useRef(false);
    const root = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const titleId = useId();

    useEffect(() => {
        mounted.current = true;
        const previous = document.activeElement as HTMLElement | null;
        searchRef.current?.focus();
        return () => {
            mounted.current = false;
            ++request.current;
            if (previous?.isConnected) previous.focus();
        };
    }, []);

    const reload = () => {
        ++request.current;
        setLoading(true);
        setRefresh(value => value + 1);
    };
    useEffect(() => history.onChanged(reload), [history]);

    useEffect(() => {
        const revision = ++request.current;
        setLoading(true);
        void history.query(search, offset, PAGE_SIZE).then(reply => {
            if (!mounted.current || revision !== request.current) return;
            // Deletion/expiry may empty the last page; move to the last valid page.
            if (reply.ok && offset > 0 && offset >= reply.total) {
                setOffset(Math.max(0, Math.ceil(reply.total / PAGE_SIZE) - 1) * PAGE_SIZE);
                return;
            }
            setResult(reply);
            setLoading(false);
        }).catch(() => {
            if (!mounted.current || revision !== request.current) return;
            setResult({ ok: false, reason: 'query-failed', message: 'Could not load browser history.' });
            setLoading(false);
        });
        return () => { ++request.current; };
    }, [history, search, offset, refresh]);

    const mutate = async (operation: () => Promise<BrowserOperationResult>) => {
        if (busy.current) return;
        busy.current = true;
        setPending(true);
        setOperationError(null);
        try {
            const reply = await operation();
            if (!mounted.current) return;
            if (reply.ok) reload();
            else if (reply.reason !== 'cancelled') setOperationError(reply.message ?? `Could not change history: ${reply.reason}`);
        } catch {
            if (mounted.current) setOperationError('Could not change browser history. Try again.');
        } finally {
            busy.current = false;
            if (mounted.current) setPending(false);
        }
    };

    return <Dialog open onClose={onClose} renderHeader={() => null} dense className="max-w-[720px]">
        <div ref={root} role="dialog" aria-modal="true" aria-labelledby={titleId} data-native-view-overlay
            className="flex min-h-0 flex-col gap-3" onKeyDown={event => {
                if (event.key !== 'Tab') return;
                const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }}>
            <div className="flex items-center gap-2">
                <h2 id={titleId} className="flex-1 text-base font-semibold">History</h2>
                <button type="button" className={button} disabled={pending} onClick={() => { void mutate(() => history.clear()); }}>Clear history</button>
                <button type="button" className={button} aria-label="Close history" onClick={onClose}>×</button>
            </div>
            <input ref={searchRef} type="search" aria-label="Search history" maxLength={8192} value={search}
                placeholder="Search titles and URLs" className="w-full rounded border border-[#c8c8c8] bg-transparent px-2 py-1 dark:border-[#555]"
                onChange={event => { ++request.current; setLoading(true); setSearch(event.target.value); setOffset(0); }} />
            {operationError && <p role="alert">{operationError}</p>}
            {result?.ok && result.storageError && <p role="alert">History storage error: {result.storageError}</p>}
            {result?.ok && !result.recording && <p role="status">History recording is paused.</p>}
            {loading ? <p role="status">Loading history…</p> : !result?.ok ? <div role="alert">
                <p>{result && !result.ok ? result.message ?? `Could not load history: ${result.reason}` : 'Could not load history.'}</p>
                <button type="button" className={button} onClick={reload}>Retry</button>
            </div> : result.entries.length === 0 ? <p role="status">{search ? 'No matching history.' : 'No browser history yet.'}</p> : <>
                <ul aria-label="History entries" className="max-h-[55vh] overflow-y-auto divide-y divide-[#e5e5e5] dark:divide-[#333]">
                    {result.entries.map(entry => <li key={entry.url} className="flex items-center gap-2 py-2">
                        <button type="button" className={`min-w-0 flex-1 text-left ${button}`} onClick={() => { onOpen(entry.url); onClose(); }}>
                            <span className="block truncate">{entry.title || entry.url}</span>
                            <span className="block truncate text-xs text-[#616161] dark:text-[#9d9d9d]">{entry.url}</span>
                            <time className="block text-xs" dateTime={new Date(entry.lastVisited).toISOString()}>{new Date(entry.lastVisited).toLocaleString()}</time>
                        </button>
                        <button type="button" className={button} aria-label={`Delete ${entry.title || entry.url}`} disabled={pending}
                            onClick={() => { void mutate(() => history.delete(entry.url)); }}>Delete</button>
                    </li>)}
                </ul>
                <div className="flex items-center justify-between gap-2">
                    <button type="button" className={button} disabled={offset === 0} onClick={() => { ++request.current; setLoading(true); setOffset(value => Math.max(0, value - PAGE_SIZE)); }}>Previous</button>
                    <span>{offset + 1}–{offset + result.entries.length} of {result.total}</span>
                    <button type="button" className={button} disabled={offset + PAGE_SIZE >= result.total} onClick={() => { ++request.current; setLoading(true); setOffset(value => value + PAGE_SIZE); }}>Next</button>
                </div>
            </>}
        </div>
    </Dialog>;
}
