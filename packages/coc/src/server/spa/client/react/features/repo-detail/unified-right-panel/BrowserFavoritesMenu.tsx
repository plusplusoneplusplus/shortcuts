import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserFavoritesResult, BrowserMostVisitedResult, BrowserOperationResult, DesktopBrowserFavorites, DesktopBrowserHistory } from '../../../shared/file-path/browser-bridge';
import { NativeViewIcon, nativeViewIconButton, nativeViewToolbarButton } from './NativeViewTab';

const item = `w-full truncate text-left ${nativeViewToolbarButton}`;
const heading = 'px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#616161] dark:text-[#9d9d9d]';
const muted = 'px-2 py-1 text-[#616161] dark:text-[#9d9d9d]';
const failure = 'px-2 py-1 text-[#a1260d] dark:text-[#f48771]';

/**
 * Star menu for desktop favorites (installation-wide) and most-visited domains
 * (derived from history in main). Entries open through `onOpen`, which the
 * owning tab routes through its own validated navigation.
 */
export function BrowserFavoritesMenu({ open, onOpenChange, favorites, history, currentPage, onOpen }: {
    open: boolean;
    onOpenChange(open: boolean): void;
    favorites: DesktopBrowserFavorites;
    history?: DesktopBrowserHistory;
    /** The committed web page; absent while loading, failed or blank. */
    currentPage?: { url: string; title: string };
    onOpen(url: string): void;
}) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const [position, setPosition] = useState({ top: 0, right: 0 });
    const [saved, setSaved] = useState<BrowserFavoritesResult | null>(null);
    const [visited, setVisited] = useState<BrowserMostVisitedResult | null>(null);
    const [pending, setPending] = useState(false);
    const [operationError, setOperationError] = useState<string | null>(null);
    const busy = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    // Always loaded so the star shows whether the current page is saved.
    useEffect(() => {
        let request = 0;
        const load = () => {
            const revision = ++request;
            void favorites.list().then(reply => { if (revision === request) setSaved(reply); })
                .catch(() => { if (revision === request) setSaved({ ok: false, reason: 'query-failed', message: 'Could not load favorites.' }); });
        };
        load();
        const off = favorites.onChanged(load);
        return () => { ++request; off(); };
    }, [favorites]);

    const hasMostVisited = Boolean(history?.mostVisited);
    useEffect(() => {
        if (!open || !history?.mostVisited) return;
        let request = 0;
        const load = () => {
            const revision = ++request;
            void history.mostVisited!().then(reply => { if (revision === request) setVisited(reply); })
                .catch(() => { if (revision === request) setVisited({ ok: false, reason: 'query-failed', message: 'Could not load most-visited sites.' }); });
        };
        load();
        const off = history.onChanged(load);
        return () => { ++request; off(); };
    }, [open, history]);

    useEffect(() => { if (!open) setOperationError(null); }, [open]);

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(4, window.innerWidth - rect.right) });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        (panelRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? panelRef.current)?.focus();
        const outside = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) onOpenChange(false);
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open, onOpenChange]);

    // A removed row or the now-disabled Save item drops focus; keep keyboard users inside the menu.
    useEffect(() => {
        const focused = document.activeElement;
        if (open && (!focused || focused === document.body || focused.matches(':disabled'))) panelRef.current?.focus();
    }, [open, saved]);

    const list = saved?.ok ? saved.favorites : [];
    const isSaved = Boolean(currentPage && list.some(entry => entry.url === currentPage.url));

    const mutate = async (operation: () => Promise<BrowserOperationResult>) => {
        if (busy.current) return;
        busy.current = true;
        setPending(true);
        setOperationError(null);
        try {
            const reply = await operation();
            if (mounted.current && !reply.ok) setOperationError(reply.message ?? `Could not change favorites: ${reply.reason}`);
        } catch {
            if (mounted.current) setOperationError('Could not change favorites. Try again.');
        } finally {
            busy.current = false;
            if (mounted.current) setPending(false);
        }
    };

    const openEntry = (url: string) => {
        onOpenChange(false);
        triggerRef.current?.focus();
        onOpen(url);
    };

    return <>
        <button
            ref={triggerRef}
            type="button"
            className={nativeViewIconButton}
            aria-label="Favorites"
            title="Favorites"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            data-testid="browser-favorites-button"
            data-saved={isSaved || undefined}
            onClick={() => onOpenChange(!open)}
            onKeyDown={event => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    onOpenChange(true);
                }
            }}
        >
            <NativeViewIcon>
                <path d="M8 2.2l1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.2l-3.53 1.85.7-3.93L2.3 6.35l3.95-.55z"
                    fill={isSaved ? 'currentColor' : 'none'} />
            </NativeViewIcon>
        </button>
        {open && createPortal(
            <div
                ref={panelRef}
                id={id}
                role="menu"
                aria-label="Favorites"
                tabIndex={-1}
                data-native-view-overlay
                data-testid="browser-favorites-menu"
                style={position}
                className="fixed z-50 w-72 max-w-[calc(100vw-8px)] max-h-[60vh] overflow-auto rounded border border-[#c8c8c8] bg-white p-1 text-xs text-[#1f1f1f] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
                onBlur={event => {
                    const next = event.relatedTarget as Node | null;
                    if (next && !event.currentTarget.contains(next) && !triggerRef.current?.contains(next)) onOpenChange(false);
                }}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenChange(false);
                        triggerRef.current?.focus();
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const actions = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
                        const current = actions.indexOf(document.activeElement as HTMLButtonElement);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
                            : (current + (event.key === 'ArrowUp' ? -1 : 1) + actions.length) % actions.length;
                        actions[next]?.focus();
                    }
                }}
            >
                <button type="button" role="menuitem" className={item} data-testid="browser-favorites-save"
                    disabled={!currentPage || isSaved || pending || !saved?.ok}
                    onClick={() => currentPage && void mutate(() => favorites.add(currentPage.url, currentPage.title))}>
                    {isSaved ? 'Current page saved' : 'Save current page'}
                </button>
                {operationError && <div role="alert" className={failure}>{operationError}</div>}
                <div role="group" aria-label="Favorites list" className="border-t border-[#e5e5e5] dark:border-[#333]">
                    <div role="presentation" className={heading}>Favorites</div>
                    {!saved ? <div role="presentation" className={muted}>Loading…</div>
                        : !saved.ok ? <div role="alert" className={failure}>{saved.message ?? `Could not load favorites: ${saved.reason}`}</div>
                        : <>
                            {saved.storageError && <div role="alert" className={failure}>Favorites storage error: {saved.storageError}</div>}
                            {list.length === 0 && <div role="presentation" className={muted}>No favorites yet.</div>}
                            {list.map(entry => <div key={entry.url} role="none" className="flex min-w-0 items-center">
                                <button type="button" role="menuitem" className={`min-w-0 flex-1 ${item}`} title={entry.url}
                                    onClick={() => openEntry(entry.url)}>{entry.title || entry.url}</button>
                                <button type="button" role="menuitem" className={`flex-shrink-0 ${nativeViewToolbarButton}`}
                                    aria-label={`Remove ${entry.title || entry.url} from favorites`} title="Remove from favorites" disabled={pending}
                                    onClick={() => void mutate(() => favorites.remove(entry.url))}>×</button>
                            </div>)}
                        </>}
                </div>
                {hasMostVisited && <div role="group" aria-label="Most visited" className="border-t border-[#e5e5e5] dark:border-[#333]">
                    <div role="presentation" className={heading}>Most visited</div>
                    {!visited ? <div role="presentation" className={muted}>Loading…</div>
                        : !visited.ok ? <div role="alert" className={failure}>{visited.message ?? `Could not load most-visited sites: ${visited.reason}`}</div>
                        : <>
                            {visited.storageError && <div role="alert" className={failure}>History storage error: {visited.storageError}</div>}
                            {visited.sites.length === 0 && <div role="presentation" className={muted}>No browsing history yet.</div>}
                            {visited.sites.map(site => <button key={site.domain} type="button" role="menuitem" className={item}
                                title={`${site.title || site.url}\n${site.url}`} onClick={() => openEntry(site.url)}>{site.domain}</button>)}
                        </>}
                </div>}
            </div>, document.body)}
    </>;
}
