import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SHOW_DIFF_FILE_PICKER } from '../../../featureFlags';
import { splitPath } from './fileBannerModel';

interface DiffFilePickerProps {
    filePath: string;
    files: readonly string[];
    onSelect?: (path: string) => void;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
    children: ReactNode;
    className?: string;
    title?: string;
    'data-testid'?: string;
}

export function DiffFilePicker({
    filePath, files, onSelect, onClick, children, className, title, 'data-testid': testId,
}: DiffFilePickerProps) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const canPick = SHOW_DIFF_FILE_PICKER && files.length > 1 && !!onSelect;
    useEffect(() => { setOpen(false); }, [files, filePath, canPick]);
    if (!canPick) {
        return <span className={className} title={title} onClick={onClick} data-testid={testId}>{children}</span>;
    }
    return (
        <>
            <button
                ref={trigger}
                type="button"
                className={`flex min-w-0 items-center gap-2 rounded text-left hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-white/5 ${className ?? ''}`}
                title={title ?? 'Jump to changed file'}
                aria-label={`Jump to file: ${filePath}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                data-testid={testId}
                onClick={event => {
                    onClick?.(event);
                    if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
                    setOpen(previous => !previous);
                }}
            >
                <span className="min-w-0">{children}</span>
                <svg aria-hidden="true" className="shrink-0 text-[#0078d4] dark:text-[#3794ff]" width="12" height="12" viewBox="0 0 12 12"><path d="m3 4 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            {open && (
                <DiffFilePickerPopover
                    filePath={filePath}
                    files={files}
                    onSelect={onSelect}
                    onClose={() => setOpen(false)}
                    anchor={trigger.current}
                />
            )}
        </>
    );
}

function DiffFilePickerPopover({
    filePath, files, onSelect, onClose, anchor,
}: {
    filePath: string;
    files: readonly string[];
    onSelect: (path: string) => void;
    onClose: () => void;
    anchor: HTMLButtonElement | null;
}) {
    const id = useId();
    const popover = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 400 });
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const matches = useMemo(() => files.filter(path => path.toLowerCase().includes(query.trim().toLowerCase())), [files, query]);
    const active = Math.min(activeIndex, Math.max(0, matches.length - 1));

    useLayoutEffect(() => {
        const rect = anchor?.getBoundingClientRect();
        const width = Math.min(560, window.innerWidth - 16);
        const below = window.innerHeight - (rect?.bottom ?? 0) - 14;
        const above = (rect?.top ?? 0) - 14;
        const height = Math.min(400, Math.max(0, below, above), window.innerHeight - 16);
        const top = below >= height || below >= above
            ? Math.max(8, Math.min((rect?.bottom ?? 2) + 6, window.innerHeight - height - 8))
            : Math.max(8, (rect?.top ?? 8) - height - 6);
        setPosition({ left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - width - 8)), top, maxHeight: height });
        input.current?.focus();
    }, [anchor]);

    useEffect(() => {
        const close = (restoreFocus: boolean) => {
            onClose();
            if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
        };
        const outside = (event: Event) => {
            if (event.target instanceof Node && !popover.current?.contains(event.target) && !anchor?.contains(event.target)) close(false);
        };
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
            }
        };
        const scroll = (event: Event) => {
            if (event.target instanceof Node && popover.current?.contains(event.target)) return;
            close(false);
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        document.addEventListener('keydown', keydown, true);
        window.addEventListener('resize', onClose);
        document.addEventListener('scroll', scroll, true);
        return () => {
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('focusin', outside);
            document.removeEventListener('keydown', keydown, true);
            window.removeEventListener('resize', onClose);
            document.removeEventListener('scroll', scroll, true);
        };
    }, [anchor, onClose]);

    useEffect(() => {
        popover.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
    }, [active, query]);

    const select = (path: string) => {
        onClose();
        if (anchor?.isConnected) anchor.focus({ preventScroll: true });
        onSelect(path);
    };

    return createPortal(
        <div
            ref={popover}
            role="dialog"
            aria-label="Jump to changed file"
            data-testid="diff-file-picker"
            className="fixed z-[10003] flex w-[560px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-[#d0d7de] bg-white font-sans text-xs shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#ccc]"
            style={position}
            onMouseDown={event => event.stopPropagation()}
        >
            <div className="border-b border-[#e0e0e0] p-3 dark:border-[#3c3c3c]">
                <div className="mb-2 flex justify-between font-semibold">
                    <span>Jump to file</span><span className="text-[#848484]">{files.length} changed files</span>
                </div>
                <input
                    ref={input}
                    role="combobox"
                    aria-label="Search changed files"
                    aria-expanded
                    aria-controls={`${id}-list`}
                    aria-activedescendant={matches[active] ? `${id}-${active}` : undefined}
                    aria-autocomplete="list"
                    className="w-full rounded border border-[#a9ccef] bg-transparent px-2 py-1.5 outline-none focus:border-[#0078d4]"
                    placeholder="Search file name or path..."
                    value={query}
                    onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
                    onKeyDown={event => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            setActiveIndex(Math.max(0, Math.min(matches.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
                        } else if (event.key === 'Enter' && matches[active]) {
                            event.preventDefault();
                            select(matches[active]);
                        }
                    }}
                />
            </div>
            <div id={`${id}-list`} role="listbox" aria-label="Changed files" className="min-h-0 overflow-auto p-1">
                {matches.map((path, index) => {
                    const { dir, base } = splitPath(path);
                    return (
                        <button
                            key={path}
                            id={`${id}-${index}`}
                            role="option"
                            type="button"
                            tabIndex={-1}
                            aria-selected={path === filePath}
                            data-option-index={index}
                            className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-[#2a2d2e] ${index === active ? 'bg-blue-50 dark:bg-[#2a2d2e]' : ''}`}
                            title={path}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => select(path)}
                        >
                            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{base}</span><span className="block truncate text-[10px] text-[#848484]">{dir}</span></span>
                            {path === filePath && <span className="text-[10px] text-[#0078d4]">Current</span>}
                        </button>
                    );
                })}
                {matches.length === 0 && <div className="p-4 text-center text-[#848484]">No changed files match your search.</div>}
            </div>
            <div className="border-t border-[#e0e0e0] px-3 py-2 text-[10px] text-[#848484] dark:border-[#3c3c3c]">
                Up/Down to select / Enter to jump / Esc to close
            </div>
        </div>,
        document.body,
    );
}
