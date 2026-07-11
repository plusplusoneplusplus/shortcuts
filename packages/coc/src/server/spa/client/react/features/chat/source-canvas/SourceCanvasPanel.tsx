/**
 * SourceCanvasPanel — docked viewer chrome for a single source file, with two
 * body modes in one slot:
 *  - `kind: 'code'` (default) → read-only syntax-highlighted / rendered-markdown
 *    viewer (`SourceCanvasBody`) over content loaded by `useSourceCanvasContent`.
 *  - `kind: 'note'` (AC-02) → the editable `SourceCanvasNoteEditor` (full
 *    `NoteEditor`, inline edit + auto-save), which loads/saves its own content.
 *
 * Renders the panel header (file name + full path, copy-path, reveal-in-explorer,
 * close) and the body region. Layout (docked column vs mobile BottomSheet) and
 * resizing are owned by the host (`ChatDetail`); this component is the inner
 * chrome only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import { Spinner } from '../../../ui/Spinner';
import { SourceCanvasBody } from './SourceCanvasBody';
import { SourceCanvasTreeBody } from './SourceCanvasTreeBody';
import { SourceCanvasNoteEditor } from './SourceCanvasNoteEditor';
import { SourceCanvasNotePopOutButton } from './SourceCanvasNotePopOutButton';
import { getSourceCanvasDisplayPath } from './resolve';
import type { SourceCanvasFileRef } from './types';
import type { SourceCanvasContentState } from './useSourceCanvasContent';
import type { SourceCanvasTreeState } from './useSourceCanvasTree';
import {
    getConversationSourceFileKey,
    type ConversationSourceFile,
} from './conversationSourceFiles';

function basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return normalized.split('/').pop() || p;
}

/** Loading-state fallback tree used until the host wires in real state. */
const EMPTY_TREE: SourceCanvasTreeState = {
    status: 'loading',
    rootEntries: [],
    resolvedPath: '',
    relativePath: '',
    wsId: '',
    truncated: false,
    error: '',
    childrenMap: new Map(),
    expanded: new Set(),
    loadingPaths: new Set(),
    errorPaths: new Map(),
    toggle: () => {},
};

const headerBtnClass =
    'shrink-0 flex items-center justify-center w-7 h-7 rounded text-[#848484] ' +
    'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

function CopyIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <path d="M4 1.5h5A1.5 1.5 0 0 1 10.5 3v.5H9V3a0 0 0 0 0 0 0H4a0 0 0 0 0 0 0v6.5H3A1.5 1.5 0 0 1 4 1.5z" opacity=".7"/>
            <rect x="5" y="4" width="7" height="8.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1"/>
        </svg>
    );
}

function RevealInExplorerIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"
             aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
            <path d="M1 4a1 1 0 0 1 1-1h3l1 1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z"/>
            <path d="M6 6.5l2 1.5-2 1.5V8H4.5v-1H6V6.5z" fill="white"/>
        </svg>
    );
}

interface SourceCanvasFileSwitcherProps {
    fileRef: SourceCanvasFileRef;
    wsId?: string | null;
    workspaceRootPath?: string | null;
    sourceFiles: readonly ConversationSourceFile[];
    onNavigate: (ref: SourceCanvasFileRef) => void;
}

function SourceCanvasFileSwitcher({
    fileRef,
    wsId,
    workspaceRootPath,
    sourceFiles,
    onNavigate,
}: SourceCanvasFileSwitcherProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const activeKey = getConversationSourceFileKey(fileRef.wsId ?? wsId ?? '', fileRef.fullPath);
    const activePath = fileRef.displayPath || getSourceCanvasDisplayPath(fileRef.fullPath, workspaceRootPath);
    const activeName = basename(activePath);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const focusOption = useCallback((offset: number) => {
        const options = containerRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="option"]',
        );
        if (!options?.length) return;
        const activeIndex = Array.from(options).findIndex(option => option.getAttribute('aria-selected') === 'true');
        const index = activeIndex >= 0 ? activeIndex : 0;
        options[(index + offset + options.length) % options.length].focus();
    }, []);

    const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => focusOption(event.key === 'ArrowDown' ? 0 : -1));
    }, [focusOption]);

    const handleOptionKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        const options = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="option"]',
        ) ?? []);
        const currentIndex = options.indexOf(event.currentTarget);
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
            return;
        }
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
            return;
        }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && currentIndex >= 0) {
            event.preventDefault();
            const nextIndex = event.key === 'ArrowDown'
                ? (currentIndex + 1) % options.length
                : (currentIndex - 1 + options.length) % options.length;
            options[nextIndex]?.focus();
        }
    }, []);

    const handleContainerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative min-w-0"
            data-testid="source-canvas-file-switcher"
            onKeyDown={handleContainerKeyDown}
        >
            <button
                ref={triggerRef}
                type="button"
                className="min-w-0 max-w-full flex items-baseline gap-1.5 rounded px-1 -mx-1 text-left hover:bg-black/[0.06] dark:hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50"
                data-testid="source-canvas-file-switcher-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Switch source file, currently ${activeName}`}
                title={fileRef.fullPath}
                onClick={() => setOpen(value => !value)}
                onKeyDown={handleTriggerKeyDown}
            >
                <span
                    className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] shrink-0"
                    data-testid="source-canvas-filename"
                >
                    {activeName}
                </span>
                <span
                    className="text-[11px] text-[#848484] truncate min-w-0 text-left"
                    dir="rtl"
                    title={fileRef.fullPath}
                    data-testid="source-canvas-path"
                >
                    <bdi>{activePath}</bdi>
                </span>
                <span className="text-[10px] text-[#848484] shrink-0" aria-hidden="true">
                    {open ? '▴' : '▾'}
                </span>
            </button>
            {open && (
                <div
                    className="absolute left-0 top-full mt-1 z-50 min-w-[220px] max-w-[min(420px,calc(100vw-2rem))] rounded border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#252526] shadow-lg py-1"
                    role="listbox"
                    aria-label="Conversation source files"
                    data-testid="source-canvas-file-switcher-menu"
                >
                    {sourceFiles.map((sourceFile) => {
                        const sourceKey = getConversationSourceFileKey(sourceFile.wsId, sourceFile.fullPath);
                        const selected = sourceKey === activeKey;
                        const sourcePath = sourceFile.displayPath
                            || getSourceCanvasDisplayPath(sourceFile.fullPath, workspaceRootPath);
                        return (
                            <button
                                key={sourceKey}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs ${
                                    selected
                                        ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]'
                                }`}
                                data-testid={`source-canvas-file-option-${sourceKey}`}
                                title={sourceFile.fullPath}
                                onClick={() => {
                                    onNavigate(sourceFile);
                                    setOpen(false);
                                    triggerRef.current?.focus();
                                }}
                                onKeyDown={handleOptionKeyDown}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium truncate">{basename(sourcePath)}</span>
                                    <span className="block text-[11px] text-[#848484] truncate">{sourcePath}</span>
                                </span>
                                {selected && (
                                    <span className="shrink-0 text-[#0078d4] dark:text-[#3794ff]" aria-label="Active file">
                                        ✓
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export interface SourceCanvasPanelProps {
    /** The file to display. */
    fileRef: SourceCanvasFileRef;
    /** Resolved workspace id, used for reveal-in-explorer. */
    wsId?: string | null;
    /** Current workspace root, used to show project-relative paths in the header. */
    workspaceRootPath?: string | null;
    /** Loaded content + load/error state (AC-06). Loading when omitted. */
    content?: SourceCanvasContentState;
    /** Expandable-tree state for `kind: 'dir'` refs. Loading when omitted. */
    tree?: SourceCanvasTreeState;
    /**
     * Open a file ref in the same panel (folder tree navigation): a clicked file
     * opens the read-only code viewer. Folders expand in place, not via this.
     */
    onNavigate?: (ref: SourceCanvasFileRef) => void;
    /** Conversation-scoped code files eligible for the source header switcher. */
    sourceFiles?: readonly ConversationSourceFile[];
    /** Close the canvas (X button). */
    onClose: () => void;
}

export function SourceCanvasPanel({
    fileRef,
    wsId,
    workspaceRootPath,
    content,
    tree,
    onNavigate,
    sourceFiles = [],
    onClose,
}: SourceCanvasPanelProps) {
    const { fullPath, displayPath } = fileRef;
    const path = displayPath || getSourceCanvasDisplayPath(fullPath, workspaceRootPath);
    const fileName = basename(path);
    const [copied, setCopied] = useState(false);
    const hasFileSwitcher = fileRef.kind !== 'note'
        && fileRef.kind !== 'dir'
        && sourceFiles.length > 1;

    const handleCopy = useCallback(() => {
        const clip = navigator.clipboard;
        if (!clip?.writeText) { return; }
        void clip.writeText(fullPath)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => { /* clipboard unavailable */ });
    }, [fullPath]);

    const handleReveal = useCallback(() => {
        if (!wsId) { return; }
        getSpaCocClient().explorer.reveal(wsId, fullPath).catch(() => { /* ignore */ });
    }, [wsId, fullPath]);

    return (
        <div
            className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]"
            data-testid="source-canvas-panel"
        >
            <div className="px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] flex items-center justify-between gap-2">
                {hasFileSwitcher && onNavigate ? (
                    <SourceCanvasFileSwitcher
                        fileRef={fileRef}
                        wsId={wsId}
                        workspaceRootPath={workspaceRootPath}
                        sourceFiles={sourceFiles}
                        onNavigate={onNavigate}
                    />
                ) : (
                    <div
                        className="min-w-0 flex items-baseline gap-1.5"
                        data-testid="source-canvas-header-titles"
                    >
                        <span
                            className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] shrink-0"
                            data-testid="source-canvas-filename"
                        >
                            {fileName}
                        </span>
                        {/* Truncate from the FRONT (dir=rtl) so the low-signal
                            `packages/coc/src/...` prefix is dropped and the meaningful
                            tail (parent folders + file) stays visible. `<bdi>` keeps the
                            path itself in normal left-to-right order. The full path is
                            preserved in the DOM for the tooltip + copy-path action. */}
                        <span
                            className="text-[11px] text-[#848484] truncate min-w-0 text-left"
                            dir="rtl"
                            title={fullPath}
                            data-testid="source-canvas-path"
                        >
                            <bdi>{path}</bdi>
                        </span>
                    </div>
                )}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        type="button"
                        data-testid="source-canvas-copy-btn"
                        onClick={handleCopy}
                        className={headerBtnClass}
                        aria-label="Copy path"
                        title={copied ? 'Copied' : 'Copy path'}
                    >
                        <CopyIcon />
                    </button>
                    <button
                        type="button"
                        data-testid="source-canvas-reveal-btn"
                        onClick={handleReveal}
                        disabled={!wsId}
                        className={`${headerBtnClass} disabled:opacity-40 disabled:cursor-default`}
                        aria-label="Reveal in Explorer"
                        title="Reveal in Explorer"
                    >
                        <RevealInExplorerIcon />
                    </button>
                    {fileRef.kind === 'note' && (
                        <SourceCanvasNotePopOutButton
                            fileRef={fileRef}
                            onClose={onClose}
                            className={headerBtnClass}
                        />
                    )}
                    <button
                        type="button"
                        data-testid="source-canvas-close-btn"
                        onClick={onClose}
                        className={headerBtnClass}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>
            {fileRef.kind === 'note' ? (
                /* Editable markdown mode (AC-02): the NoteEditor loads + saves
                   its own content, so the read-only fetch/states are skipped. */
                <div
                    className="flex-1 min-h-0 overflow-hidden flex flex-col"
                    data-testid="source-canvas-body"
                >
                    <SourceCanvasNoteEditor fileRef={fileRef} />
                </div>
            ) : fileRef.kind === 'dir' ? (
                /* Read-only expandable file tree: the tree state is loaded by the
                   host; folders expand in place, files navigate via onNavigate. */
                <div className="flex-1 min-h-0 overflow-auto" data-testid="source-canvas-body">
                    <SourceCanvasTreeBody
                        tree={tree ?? EMPTY_TREE}
                        folderName={fileName}
                        onNavigate={onNavigate ?? (() => {})}
                    />
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-auto" data-testid="source-canvas-body">
                    {/* Read-only code mode: AC-06 loading / error states; AC-04
                        success rendering (markdown vs syntax-highlighted source). */}
                    {(!content || content.status === 'loading') && (
                        <div
                            className="flex items-center gap-2 p-4 text-xs text-[#848484]"
                            data-testid="source-canvas-loading"
                        >
                            <Spinner size="sm" /> Loading {fileName}…
                        </div>
                    )}
                    {content && content.status === 'error' && (
                        <div className="p-4 text-xs" data-testid="source-canvas-error">
                            <div
                                className="font-medium text-[#cc4444] dark:text-[#f48771]"
                                data-testid="source-canvas-error-msg"
                            >
                                {`Couldn't load ${content.resolvedPath || path}`}
                            </div>
                            {content.error && (
                                <div className="mt-1 text-[#848484]">{content.error}</div>
                            )}
                        </div>
                    )}
                    {content && content.status === 'success' && (
                        <SourceCanvasBody
                            fileName={fileName}
                            content={content.content}
                            language={content.language}
                            line={fileRef.line}
                            endLine={fileRef.endLine}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
