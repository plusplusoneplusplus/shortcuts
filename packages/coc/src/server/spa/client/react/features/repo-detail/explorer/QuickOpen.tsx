/**
 * QuickOpen — the command palette, in files mode or symbols mode.
 *
 * One dialog, two questions. `Ctrl+P` opens it on files, `Ctrl+,` on symbols
 * (Visual Studio's Go To All), and the typed prefixes `f `, `t `, `m ` and
 * `:N` move between them without closing anything — see `paletteQuery.ts` for
 * the grammar. Keeping it one component is the point: two palettes would drift
 * apart in keyboard handling, highlighting and placement, and could stack.
 *
 * Files are searched on the server, debounced, and only the top matches are
 * rendered. The repo path list never crosses the network — in a large repo that
 * list is multiple megabytes, and matching it on the render thread stalls
 * typing. Symbols are answered over the language-server bridge instead
 * (`useWorkspaceSymbols`), fanned out across every server that can answer and
 * merged as the answers land, so the fast index shows results while a heavier
 * server is still warming.
 *
 * Portal-rendered to document.body.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import type {
    ExplorerRepoGroupSearchResult,
    ExplorerSearchResult,
} from '@plusplusoneplusplus/coc-client';
import { cn } from '../../../ui/cn';
import { searchRepoGroupFiles } from '../../../repos/repoGroupService';
import { useRepoGroupMembers } from '../../../repos/useRepoGroupMembers';
import { useWorkspaceSymbols } from '../../language-servers/useWorkspaceSymbols';
import type { WorkspaceSymbolScopeMember } from '../../language-servers/useWorkspaceSymbols';
import type { WorkspaceSymbolResult } from '../../language-servers/workspaceSymbols';
import { explorerApi } from './explorerApi';
import { FileNameIcon } from './FileTypeIcon';
import { matchesKindFilter, parsePaletteQuery, type PaletteMode } from './paletteQuery';

/** Maximum results requested and rendered for a query. */
const RESULT_LIMIT = 50;

/**
 * How long typing must pause before a search is issued. Short enough to feel
 * immediate on a localhost round-trip, long enough that a fast typist issues one
 * request instead of one per character.
 */
const SEARCH_DEBOUNCE_MS = 40;

/**
 * The prefix grammar, spelled out for the user. The prefixes in
 * `paletteQuery.ts` are worth nothing if nobody knows they exist, so the
 * palette names them wherever it has room: in the empty state before anything
 * is typed, and in the footer until a prefix takes over the label.
 */
const PREFIX_HINTS: ReadonlyArray<{ prefix: string; label: string }> = [
    { prefix: 'f', label: 'files' },
    { prefix: 't', label: 'types' },
    { prefix: 'm', label: 'members' },
    { prefix: ':42', label: 'line' },
];

function PrefixHints({ testId }: { testId: string }) {
    return (
        <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1" data-testid={testId}>
            {PREFIX_HINTS.map(({ prefix, label }) => (
                <span key={prefix} className="whitespace-nowrap">
                    <code className="rounded bg-[#e8e8e8] dark:bg-[#3c3c3c] px-1 text-[#555] dark:text-[#d4d4d4]">
                        {prefix}
                    </code>{' '}
                    {label}
                </span>
            ))}
        </span>
    );
}

export type QuickOpenScope =
    | { kind: 'repo'; workspaceId: string; routingRef?: string | null }
    | { kind: 'repo-group'; groupId: string; groupName: string; liveRepoCount: number; baseUrl?: string };

export type QuickOpenResult = ExplorerSearchResult | ExplorerRepoGroupSearchResult;
export type QuickOpenSelectionOutcome =
    | void
    | boolean
    | { error: string; retry?: boolean };

export interface QuickOpenProps {
    scope: QuickOpenScope;
    open: boolean;
    onClose: () => void;
    /** Return false to keep the dialog open without changing its selection. */
    onFileSelect: (result: QuickOpenResult) => QuickOpenSelectionOutcome | Promise<QuickOpenSelectionOutcome>;
    /** Which question the dialog opens on. A typed prefix can change it. */
    mode?: PaletteMode;
    /** Required for symbols mode; without it `Ctrl+,` has nowhere to navigate. */
    onSymbolSelect?: (
        result: WorkspaceSymbolResult,
    ) => QuickOpenSelectionOutcome | Promise<QuickOpenSelectionOutcome>;
    /** `:N` jumps here. Absent means the dialog has no active editor: inert. */
    onLineSelect?: (line: number) => void;
}

/** A glyph per LSP `SymbolKind`, falling back to the generic one. */
const KIND_GLYPHS: Record<number, string> = {
    2: '📦', 3: '⬡', 5: '🅲', 6: 'ƒ', 7: '◆', 8: '▪', 9: '🅲',
    10: '🅴', 11: '🅸', 12: 'ƒ', 13: '𝑥', 14: '#', 22: '▫', 23: '🅢',
};

/**
 * Emphasise the characters at `indices` in `target`.
 *
 * The indices come from the scorer that produced the result, so the highlight
 * always shows the match the ranking was based on — re-deriving it here used to
 * let the two disagree.
 */
export function highlightMatches(target: string, indices: readonly number[]): (string | JSX.Element)[] {
    if (indices.length === 0) return [target];
    const marked = new Set(indices);
    const parts: (string | JSX.Element)[] = [];
    let buf = '';
    let keyIdx = 0;

    for (let i = 0; i < target.length; i++) {
        if (marked.has(i)) {
            if (buf) { parts.push(buf); buf = ''; }
            parts.push(<span key={keyIdx++} className="text-[#0078d4] dark:text-[#3794ff] font-semibold">{target[i]}</span>);
        } else {
            buf += target[i];
        }
    }
    if (buf) parts.push(buf);
    return parts;
}

/**
 * Split a result's match indices into the directory part and the file-name
 * part, rebased on each, so both segments highlight correctly.
 */
export function splitIndices(filePath: string, indices: readonly number[]): { dir: number[]; name: number[] } {
    const nameStart = filePath.length - fileName(filePath).length;
    const dir: number[] = [];
    const name: number[] = [];
    for (const index of indices) {
        if (index < dirName(filePath).length) dir.push(index);
        else if (index >= nameStart) name.push(index - nameStart);
    }
    return { dir, name };
}

function fileName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? p : p.slice(idx + 1);
}

function dirName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? '' : p.slice(0, idx);
}

export interface FileNameDisplayParts {
    stem: string;
    suffix: string;
    stemIndices: number[];
    suffixIndices: number[];
}

/** Keep the final extension separate so flex truncation can never hide it. */
export function splitFileNameForDisplay(
    name: string,
    indices: readonly number[] = [],
): FileNameDisplayParts {
    const dot = name.lastIndexOf('.');
    const suffixStart = dot > 0 && dot < name.length - 1 ? dot : name.length;
    return {
        stem: name.slice(0, suffixStart),
        suffix: name.slice(suffixStart),
        stemIndices: indices.filter(index => index < suffixStart),
        suffixIndices: indices.filter(index => index >= suffixStart).map(index => index - suffixStart),
    };
}

function FileNameLabel({
    name,
    indices = [],
    testId,
    suffixTestId,
    className,
}: {
    name: string;
    indices?: readonly number[];
    testId?: string;
    suffixTestId?: string;
    className?: string;
}) {
    const parts = splitFileNameForDisplay(name, indices);
    return (
        <span className={cn('flex min-w-0 items-baseline', className)} title={name} data-testid={testId}>
            <span className="truncate">{highlightMatches(parts.stem, parts.stemIndices)}</span>
            {parts.suffix && (
                <span
                    className="flex-shrink-0 font-mono text-[#0067b8] dark:text-[#75beff]"
                    data-testid={suffixTestId}
                >
                    {highlightMatches(parts.suffix, parts.suffixIndices)}
                </span>
            )}
        </span>
    );
}

function isGroupResult(result: QuickOpenResult): result is ExplorerRepoGroupSearchResult {
    return 'workspaceId' in result;
}

function isSymbolResult(result: QuickOpenResult | WorkspaceSymbolResult): result is WorkspaceSymbolResult {
    return 'definitionId' in result;
}

/** Stable identity of a rendered row, used to pin the highlight across merges. */
function rowKey(result: QuickOpenResult | WorkspaceSymbolResult): string {
    if (isSymbolResult(result)) {
        return `${result.workspaceId ?? ''}:${result.path}:${result.line}:${result.name}`;
    }
    return isGroupResult(result) ? `${result.workspaceId}:${result.path}` : result.path;
}

export function QuickOpen({
    scope,
    open,
    onClose,
    onFileSelect,
    mode = 'files',
    onSymbolSelect,
    onLineSelect,
}: QuickOpenProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<QuickOpenResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [groupStatus, setGroupStatus] = useState<'complete' | 'partial' | 'failed' | 'no-searchable-members' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestIdRef = useRef(0);
    /** Identity of the highlighted row, so a merge cannot shift the selection. */
    const highlightKeyRef = useRef<string | null>(null);
    const scopeKey = scope.kind === 'repo'
        ? `repo:${scope.routingRef ?? scope.workspaceId}`
        : `group:${scope.groupId}:${scope.baseUrl ?? ''}`;

    const parsed = parsePaletteQuery(query, mode);
    const symbolsMode = parsed.mode === 'symbols';
    // Group membership is only fetched once the palette actually needs it, so
    // Ctrl+P in a group still costs no extra request.
    const groupMembers = useRepoGroupMembers(
        scope.kind === 'repo-group' ? scope.groupId : '',
        scope.kind === 'repo-group' ? scope.baseUrl : undefined,
        open && symbolsMode && scope.kind === 'repo-group',
    );
    const symbolMembers = useMemo<WorkspaceSymbolScopeMember[]>(() => {
        if (scope.kind === 'repo') {
            return [{ workspaceId: scope.workspaceId, routingRef: scope.routingRef }];
        }
        return (groupMembers ?? [])
            .filter(member => !member.stale)
            .map(member => ({ workspaceId: member.workspaceId, repoName: member.name ?? member.workspaceId }));
    }, [scopeKey, groupMembers]);
    const symbols = useWorkspaceSymbols({
        open: open && symbolsMode,
        members: symbolMembers,
        query: parsed.term,
        debounceMs: SEARCH_DEBOUNCE_MS,
        limit: RESULT_LIMIT,
    });
    const visibleSymbols = useMemo(
        () => symbols.results.filter(result => matchesKindFilter(result.kind, parsed.kindFilter)),
        [symbols.results, parsed.kindFilter],
    );
    const rows: (QuickOpenResult | WorkspaceSymbolResult)[] = symbolsMode ? visibleSymbols : results;

    // Start each open from a clean slate; nothing is fetched until the first
    // keystroke, so opening the dialog costs no network at all.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setResults([]);
        setHighlightIndex(0);
        highlightKeyRef.current = null;
        setGroupStatus(null);
        setError(null);
    }, [open, scopeKey]);

    // Search on the server, debounced, one in-flight request at a time.
    useEffect(() => {
        const requestId = ++requestIdRef.current;
        if (!open) {
            abortRef.current?.abort();
            setError(null);
            setGroupStatus(null);
            return;
        }

        const trimmed = symbolsMode ? '' : parsed.term;
        if (!trimmed) {
            abortRef.current?.abort();
            setResults([]);
            setLoading(false);
            setError(null);
            setGroupStatus(null);
            return;
        }

        debounceRef.current = setTimeout(() => {
            abortRef.current?.abort();
            const abort = new AbortController();
            abortRef.current = abort;
            setLoading(true);
            const searching = scope.kind === 'repo'
                ? explorerApi.searchFiles(
                    scope.workspaceId,
                    trimmed,
                    { limit: RESULT_LIMIT, signal: abort.signal },
                    scope.routingRef,
                )
                : searchRepoGroupFiles(
                    scope.groupId,
                    trimmed,
                    { limit: RESULT_LIMIT, signal: abort.signal },
                    scope.baseUrl,
                );
            searching
                .then(data => {
                    if (abort.signal.aborted || requestId !== requestIdRef.current || !open) return;
                    setError(null);
                    if ('status' in data) {
                        setGroupStatus(data.status);
                        if (data.status === 'failed') {
                            setResults([]);
                            setError('Could not search this repo group.');
                            return;
                        }
                    }
                    setResults(data.results);
                })
                .catch(() => {
                    if (abort.signal.aborted || requestId !== requestIdRef.current || !open) return;
                    if (scope.kind === 'repo-group') {
                        setError('Could not search this repo group.');
                        setGroupStatus('failed');
                    } else {
                        setResults([]);
                    }
                })
                .finally(() => {
                    if (!abort.signal.aborted && requestId === requestIdRef.current) setLoading(false);
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
    }, [parsed.term, symbolsMode, open, retry, scopeKey]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    // Auto-focus input when opened, then restore the prior focus on close.
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        requestAnimationFrame(() => inputRef.current?.focus());
        return () => previous?.focus();
    }, [open]);

    // Keep the highlight on the row it was on, by identity rather than index:
    // a slower server folding its results in must never move the selection out
    // from under an Enter press.
    useEffect(() => {
        setHighlightIndex(previous => {
            const pinned = highlightKeyRef.current;
            const next = pinned ? rows.findIndex(row => rowKey(row) === pinned) : -1;
            return next >= 0 ? next : Math.min(previous, Math.max(rows.length - 1, 0));
        });
    }, [rows]);

    useEffect(() => {
        highlightKeyRef.current = rows[highlightIndex] ? rowKey(rows[highlightIndex]) : null;
    }, [rows, highlightIndex]);

    // Scroll highlighted item into view
    useEffect(() => {
        const item = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[highlightIndex];
        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex]);

    const handleSelect = useCallback(async (result: QuickOpenResult | WorkspaceSymbolResult) => {
        const outcome = isSymbolResult(result)
            ? await onSymbolSelect?.(result)
            : await onFileSelect(result);
        if (outcome === false) return;
        if (typeof outcome === 'object') {
            setError(outcome.error);
            if (outcome.retry) setRetry(value => value + 1);
            return;
        }
        onClose();
    }, [onFileSelect, onSymbolSelect, onClose]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(i => Math.min(i + 1, rows.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (parsed.lineTarget !== undefined) {
                // `:N` with no active editor is inert, not an error.
                onLineSelect?.(parsed.lineTarget);
                if (onLineSelect) onClose();
            } else if (rows[highlightIndex]) {
                void handleSelect(rows[highlightIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }, [rows, highlightIndex, handleSelect, onClose, parsed.lineTarget, onLineSelect]);

    if (!open) return null;

    const overlay = (
        <div
            className="fixed inset-0 z-[10002] flex justify-center"
            onClick={onClose}
            data-testid="quick-open-overlay"
        >
            {/* Dialog at top-center, matching the command palette placement. */}
            <div
                className={cn(
                    'mt-[10vh] w-[90vw] max-w-[600px] h-fit max-h-[60vh] flex flex-col',
                    'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    'rounded-md shadow-xl overflow-hidden',
                )}
                onClick={e => e.stopPropagation()}
                data-testid="quick-open-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={symbolsMode
                    ? (scope.kind === 'repo-group' ? `Go to symbol in ${scope.groupName}` : 'Go to symbol')
                    : (scope.kind === 'repo-group' ? `Open file in ${scope.groupName}` : 'Open file')}
            >
                {scope.kind === 'repo-group' && (
                    <div className="px-3 pt-2 text-xs font-medium text-[#616161] dark:text-[#c8c8c8]">
                        {symbolsMode ? 'Go to symbol in' : 'Open file in'} {scope.groupName}
                    </div>
                )}
                {/* Search input */}
                <div className="flex items-center px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-[#999] dark:text-[#888] mr-2 text-sm">🔍</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={symbolsMode ? 'Search symbols by name…' : 'Search files by name…'}
                        className={cn(
                            'flex-1 bg-transparent text-sm text-[#1e1e1e] dark:text-[#cccccc]',
                            'outline-none border-none placeholder-[#999] dark:placeholder-[#888]',
                        )}
                        data-testid="quick-open-input"
                    />
                    {query && (
                        <button
                            className="text-[#999] hover:text-[#333] dark:hover:text-[#eee] text-sm ml-2"
                            onClick={() => setQuery('')}
                            data-testid="quick-open-clear"
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Results list */}
                <div
                    ref={listRef}
                    className="flex-1 overflow-y-auto"
                    data-testid="quick-open-results"
                    role="listbox"
                >
                    {(groupStatus === 'partial' || symbols.status === 'partial') && (
                        <div className="px-3 py-1.5 text-xs text-[#8a6d1d] dark:text-[#cca700]" data-testid="quick-open-partial">
                            Some repositories could not be searched.
                        </div>
                    )}
                    {symbolsMode && symbols.indexing && rows.length > 0 && (
                        <div className="px-3 py-1.5 text-xs text-[#8a6d1d] dark:text-[#cca700]" data-testid="quick-open-indexing-note">
                            Some repositories are still indexing.
                        </div>
                    )}
                    {/* Only blank out while the first search of a query is in
                        flight — once results exist they stay rendered, so typing
                        never flickers. */}
                    {parsed.lineTarget !== undefined ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-line-target">
                            {onLineSelect
                                ? `Press ↵ to go to line ${parsed.lineTarget}.`
                                : 'Open a file first to jump to a line.'}
                        </div>
                    ) : !parsed.term && (symbolsMode || scope.kind === 'repo-group') ? (
                        <div className="flex flex-col items-center justify-center gap-1.5 py-4 text-sm text-[#848484]" data-testid="quick-open-empty-query">
                            <span>
                                {symbolsMode
                                    ? 'Type to search symbols.'
                                    : `Type to search across ${scope.kind === 'repo-group' ? scope.liveRepoCount : 1} ${scope.kind === 'repo-group' && scope.liveRepoCount === 1 ? 'repository' : 'repositories'}.`}
                            </span>
                            <span className="text-xs">
                                <PrefixHints testId="quick-open-prefix-hints" />
                            </span>
                        </div>
                    ) : symbolsMode && symbols.unavailable ? (
                        <div className="flex flex-col items-center justify-center gap-1 py-4 px-3 text-center text-sm text-[#848484]" data-testid="quick-open-unavailable">
                            <span>{symbols.unavailable.detail}</span>
                            {symbols.unavailable.recoveryCommand && (
                                <code className="text-xs text-[#616161] dark:text-[#c8c8c8]">
                                    {symbols.unavailable.recoveryCommand}
                                </code>
                            )}
                        </div>
                    ) : symbolsMode && symbols.indexing && rows.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-indexing">
                            Indexing…
                        </div>
                    ) : (symbolsMode ? symbols.loading : loading) && rows.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]">
                            {symbolsMode ? 'Searching symbols…' : 'Searching files…'}
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-4 text-sm text-[#b42318] dark:text-[#f48771]" data-testid="quick-open-error">
                            <span>{error}</span>
                            <button
                                className="rounded border border-current px-2 py-0.5 text-xs"
                                onClick={() => setRetry(value => value + 1)}
                            >
                                Retry
                            </button>
                        </div>
                    ) : (symbolsMode ? symbols.status : groupStatus) === 'no-searchable-members' ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-no-members">
                            This repo group has no searchable repositories.
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="flex items-center justify-center py-4 text-sm text-[#848484]" data-testid="quick-open-no-results">
                            {symbolsMode
                                ? 'No symbols found'
                                : scope.kind === 'repo-group' ? 'No files found in this repo group.' : 'No matching files'}
                        </div>
                    ) : (
                        rows.map((result, idx) => {
                            const symbol = isSymbolResult(result) ? result : null;
                            const matched = symbol
                                ? { dir: [], name: [] }
                                : splitIndices(result.path, result.indices ?? []);
                            const repoName = symbol
                                ? symbol.repoName
                                : isGroupResult(result) ? result.repoName : undefined;
                            return (
                                <div
                                    key={rowKey(result)}
                                    className={cn(
                                        'flex items-center px-3 py-1.5 cursor-pointer text-sm',
                                        idx === highlightIndex
                                            ? 'bg-[#0078d4]/10 dark:bg-[#0078d4]/20'
                                            : 'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e]',
                                    )}
                                    onClick={() => void handleSelect(result)}
                                    onMouseEnter={() => setHighlightIndex(idx)}
                                    data-testid={`quick-open-item-${idx}`}
                                    role="option"
                                    aria-selected={idx === highlightIndex}
                                    aria-label={[
                                        symbol ? symbol.name : fileName(result.path),
                                        symbol ? symbol.containerName ?? '' : dirName(result.path),
                                        repoName ?? '',
                                    ].filter(Boolean).join(', ')}
                                >
                                    {symbol ? (
                                        <span
                                            className="text-xs mr-2 opacity-60"
                                            data-testid={`quick-open-symbol-kind-${idx}`}
                                        >
                                            {KIND_GLYPHS[symbol.kind] ?? 'ƒ'}
                                        </span>
                                    ) : (
                                        <span className="mr-2">
                                            <FileNameIcon
                                                fileName={fileName(result.path)}
                                                testId={`quick-open-file-icon-${idx}`}
                                            />
                                        </span>
                                    )}
                                    {symbol ? (
                                        <span
                                            className="min-w-0 truncate font-medium text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid={`quick-open-symbol-name-${idx}`}
                                        >
                                            {highlightMatches(symbol.name, symbol.indices ?? [])}
                                        </span>
                                    ) : (
                                        <FileNameLabel
                                            name={fileName(result.path)}
                                            indices={matched.name}
                                            testId={`quick-open-file-name-${idx}`}
                                            suffixTestId={`quick-open-file-suffix-${idx}`}
                                            className="shrink font-medium text-[#1e1e1e] dark:text-[#cccccc]"
                                        />
                                    )}
                                    {symbol?.containerName && (
                                        <span className="ml-2 text-xs text-[#848484] truncate flex-shrink-0">
                                            {symbol.containerName}
                                        </span>
                                    )}
                                    {!symbol && dirName(result.path) && (
                                        <span className="ml-2 min-w-0 flex-1 truncate text-xs text-[#848484]">
                                            {highlightMatches(dirName(result.path), matched.dir)}
                                        </span>
                                    )}
                                    {symbol && (
                                        <span className="ml-auto flex min-w-0 items-center pl-2 text-xs text-[#848484]">
                                            <FileNameIcon
                                                fileName={fileName(symbol.path)}
                                                showTitle={false}
                                                testId={`quick-open-symbol-file-icon-${idx}`}
                                            />
                                            <span
                                                className="ml-1 flex min-w-0 items-baseline"
                                                data-testid={`quick-open-symbol-path-${idx}`}
                                            >
                                                {dirName(symbol.path) && (
                                                    <span className="min-w-0 truncate">{dirName(symbol.path)}/</span>
                                                )}
                                                <FileNameLabel
                                                    name={fileName(symbol.path)}
                                                    suffixTestId={`quick-open-symbol-suffix-${idx}`}
                                                    className="min-w-0"
                                                />
                                                <span className="flex-shrink-0">:{symbol.line}</span>
                                            </span>
                                        </span>
                                    )}
                                    {repoName && (
                                        <span className={cn(
                                            'rounded bg-[#e8e8e8] dark:bg-[#3c3c3c] px-1.5 py-0.5 text-[10px] text-[#555] dark:text-[#d4d4d4]',
                                            symbol ? 'ml-2 flex-shrink-0' : 'ml-auto',
                                        )} data-testid={`quick-open-repo-${idx}`}>
                                            {repoName}
                                        </span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer hint */}
                <div className="flex items-center justify-between px-3 py-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-[10px] text-[#848484]">
                    <span className="flex items-center gap-2">
                        {parsed.filterLabel
                            ? <span>{parsed.filterLabel} ·</span>
                            : <PrefixHints testId="quick-open-footer-hints" />}
                        <span>↑↓ navigate · ↵ open · esc close</span>
                    </span>
                    {rows.length > 0 && (
                        <span>
                            {rows.length} results{symbolsMode && symbols.streaming ? ' (searching…)' : ''}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );

    return ReactDOM.createPortal(overlay, document.body);
}
