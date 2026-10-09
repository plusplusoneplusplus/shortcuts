import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserHistorySuggestion, DesktopBrowserHistory } from '../../../shared/file-path/browser-bridge';

/** Editing stays local; matching, ranking and persistence belong to main. */
export function BrowserAddressBar({ inputRef, url, history, enabled, ownerKey, invalid, onEdit, onOpen }: {
    inputRef: RefObject<HTMLInputElement>;
    url?: string;
    history?: DesktopBrowserHistory;
    enabled: boolean;
    ownerKey: string;
    invalid: boolean;
    onEdit(): void;
    onOpen(url: string): string | void;
}) {
    const id = useId();
    const [address, setAddress] = useState(url ?? '');
    const [search, setSearch] = useState(url ?? '');
    const typed = useRef(url ?? '');
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState<BrowserHistorySuggestion[]>([]);
    const [selected, setSelected] = useState(-1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);
    const completion = useRef<BrowserHistorySuggestion | null>(null);
    const selection = useRef<number | null>(null);
    const suppress = useRef(true);
    const composing = useRef(false);
    const revision = useRef(0);
    const currentOwner = useRef(ownerKey);
    currentOwner.current = ownerKey;
    const currentEnabled = useRef(enabled);
    currentEnabled.current = enabled;
    const previousScope = useRef({ ownerKey, enabled });
    const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 0 });
    const shown = open && enabled && Boolean(history) && previousScope.current.ownerKey === ownerKey;

    const discardCompletion = () => {
        suppress.current = true;
        completion.current = null;
        selection.current = null;
        setAddress(typed.current);
        setSelected(-1);
    };
    const dismiss = () => {
        revision.current++;
        discardCompletion();
        setOpen(false);
        setEntries([]);
    };

    useEffect(() => {
        if (previousScope.current.ownerKey === ownerKey && previousScope.current.enabled === enabled) return;
        const ownerChanged = previousScope.current.ownerKey !== ownerKey;
        previousScope.current = { ownerKey, enabled };
        dismiss();
        // Scope changes must not retain the previous tab's draft.
        if (!ownerChanged) return;
        typed.current = url ?? '';
        setAddress(typed.current);
        setSearch(typed.current);
    }, [ownerKey, enabled]);

    useEffect(() => {
        // Live page updates do not replace an address being edited.
        if (document.activeElement === inputRef.current && shown) return;
        typed.current = url ?? '';
        setAddress(typed.current);
        setSearch(typed.current);
    }, [url, inputRef]);

    useEffect(() => history?.onChanged(() => {
        revision.current++;
        discardCompletion();
        setEntries([]);
        setRefresh(value => value + 1);
    }), [history]);

    useEffect(() => {
        if (!shown || !history || composing.current) return;
        const request = ++revision.current;
        const owner = ownerKey;
        const isCurrent = () => request === revision.current && currentOwner.current === owner
            && currentEnabled.current && document.activeElement === inputRef.current;
        setLoading(true);
        setError(null);
        setEntries([]);
        setSelected(-1);
        void history.suggest(search).then(result => {
            if (!isCurrent()) return;
            setLoading(false);
            if (!result.ok) {
                setError(result.message ?? `History unavailable: ${result.reason}`);
                return;
            }
            const suggestions = result.entries.slice(0, 8);
            setEntries(suggestions);
            setError(result.storageError);
            const first = suggestions[0];
            const input = inputRef.current;
            if (!suppress.current && !composing.current && first?.completion && input
                && search.length > 0 && first.completion.length > search.length
                && first.completion.toLowerCase().startsWith(search.toLowerCase())
                && input.selectionStart === search.length && input.selectionEnd === search.length) {
                completion.current = first;
                selection.current = search.length;
                setAddress(search + first.completion.slice(search.length));
            }
        }).catch(() => {
            if (!isCurrent()) return;
            setLoading(false);
            setError('History unavailable. You can still enter a URL.');
        });
        return () => { revision.current++; };
    }, [history, shown, search, refresh, ownerKey, inputRef]);

    useLayoutEffect(() => {
        if (selection.current === null) return;
        inputRef.current?.setSelectionRange(selection.current, address.length);
        selection.current = null;
    }, [address, inputRef]);

    useLayoutEffect(() => {
        if (!shown) return;
        const update = () => {
            const rect = inputRef.current?.getBoundingClientRect();
            if (!rect) return;
            const left = Math.max(4, Math.min(rect.left, window.innerWidth - 4));
            const top = rect.bottom + 4;
            setPosition({ top, left, width: Math.max(0, Math.min(rect.width, window.innerWidth - left - 4)),
                maxHeight: Math.max(0, Math.min(window.innerHeight * 0.4, window.innerHeight - top - 4)) });
        };
        update();
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        if (inputRef.current) resize?.observe(inputRef.current);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            resize?.disconnect();
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [shown, inputRef]);

    useEffect(() => {
        if (selected >= 0) document.getElementById(`${id}-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [id, selected]);

    const activate = (value: string) => {
        if (!currentEnabled.current || currentOwner.current !== ownerKey || composing.current) return;
        dismiss();
        typed.current = value;
        setAddress(value);
        setSearch(value);
        const normalized = onOpen(value);
        if (typeof normalized === 'string') {
            typed.current = normalized;
            setAddress(normalized);
            setSearch(normalized);
        }
    };
    const submitAddress = () => activate(shown && selected >= 0 ? entries[selected].url : completion.current?.url ?? address);

    return <>
        <form className="flex min-w-0 flex-1" onSubmit={event => { event.preventDefault(); submitAddress(); }}>
            <input
                ref={inputRef}
                type="text"
                value={address}
                role={history ? 'combobox' : undefined}
                aria-autocomplete={history ? 'both' : undefined}
                aria-haspopup={history ? 'listbox' : undefined}
                aria-expanded={history ? shown : undefined}
                aria-controls={shown ? id : undefined}
                aria-activedescendant={shown && selected >= 0 ? `${id}-${selected}` : undefined}
                onFocus={() => {
                    if (!enabled || !history) return;
                    suppress.current = true;
                    setOpen(true);
                    setRefresh(value => value + 1);
                }}
                onBlur={dismiss}
                onChange={event => {
                    revision.current++;
                    const input = event.target;
                    const inputType = (event.nativeEvent as InputEvent).inputType;
                    if (inputType) suppress.current = inputType !== 'insertText';
                    typed.current = input.value;
                    completion.current = null;
                    setAddress(input.value);
                    setSearch(input.value);
                    setEntries([]);
                    setSelected(-1);
                    setOpen(!composing.current);
                    setRefresh(value => value + 1);
                    onEdit();
                }}
                onBeforeInput={event => {
                    const inputType = (event.nativeEvent as InputEvent).inputType;
                    if (inputType) suppress.current = inputType !== 'insertText';
                }}
                onPaste={() => { suppress.current = true; completion.current = null; revision.current++; }}
                onCompositionStart={() => { composing.current = true; dismiss(); }}
                onCompositionEnd={event => {
                    composing.current = false;
                    suppress.current = true;
                    typed.current = event.currentTarget.value;
                    setSearch(typed.current);
                    setOpen(true);
                    setRefresh(value => value + 1);
                }}
                onPointerDown={() => {
                    // A click may move the caret within the completed text. Keep that
                    // text as an ordinary editable value rather than reselecting it.
                    suppress.current = true;
                    completion.current = null;
                    typed.current = address;
                    setSearch(address);
                    revision.current++;
                    setRefresh(value => value + 1);
                    if (enabled && history) setOpen(true);
                }}
                onKeyDown={event => {
                    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
                        if (event.key === 'Enter') event.preventDefault();
                        return;
                    }
                    if (event.key === 'Escape' && shown) {
                        event.preventDefault();
                        event.stopPropagation();
                        dismiss();
                    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && shown && entries.length) {
                        event.preventDefault();
                        completion.current = null;
                        suppress.current = true;
                        const next = selected < 0 ? (event.key === 'ArrowDown' ? 0 : entries.length - 1)
                            : (selected + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
                        setSelected(next);
                        setAddress(entries[next].url);
                    } else if (event.key === 'Enter') {
                        event.preventDefault();
                        submitAddress();
                    } else if (event.key === 'Backspace' || event.key === 'Delete') {
                        suppress.current = true;
                        completion.current = null;
                        revision.current++;
                    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        suppress.current = true;
                        completion.current = null;
                        typed.current = address;
                        setSearch(address);
                        revision.current++;
                        setSelected(-1);
                    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                        suppress.current = false;
                    }
                }}
                placeholder="Enter a URL"
                aria-label="Address"
                aria-invalid={invalid}
                spellCheck={false}
                autoComplete="off"
                autoFocus={!url}
                className="min-w-0 flex-1 rounded border border-[#c8c8c8] bg-transparent px-2 py-1 outline-none focus:border-[#007acc] dark:border-[#3c3c3c]"
                data-testid="browser-address"
            />
        </form>
        {shown && createPortal(
            <div data-native-view-overlay style={position}
                className="fixed z-50 overflow-auto rounded border border-[#c8c8c8] bg-white text-xs text-[#1f1f1f] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]">
                <div id={id} role="listbox" aria-label="Browser history suggestions" aria-busy={loading}>
                    {entries.map((entry, index) => <div key={entry.url} id={`${id}-${index}`} role="option"
                        aria-selected={selected === index}
                        className={`cursor-pointer px-2 py-1 ${selected === index ? 'bg-[#e8e8e8] dark:bg-[#37373d]' : 'hover:bg-[#e8e8e8] dark:hover:bg-[#37373d]'}`}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => activate(entry.url)}>
                        <div className="truncate">{entry.title || entry.url}</div>
                        <div className="truncate text-[#616161] dark:text-[#9d9d9d]">{entry.url}</div>
                    </div>)}
                </div>
                {loading && <div role="status" className="px-2 py-1">Loading history…</div>}
                {error && <div role="status" className="px-2 py-1">{error}</div>}
                {!loading && !error && entries.length === 0 && <div role="status" className="px-2 py-1">No history matches.</div>}
            </div>, document.body)}
    </>;
}
