/**
 * ContentSearchResults — renders content-search hits as a collapsible tree,
 * grouped by file, the way VS Code's Search side bar does.
 *
 * One header row per file (twisty + file name + dimmed directory + match count),
 * and under it one row per match showing the matching line with the matched span
 * highlighted. Clicking a match asks the owner to open that file at that line.
 *
 * Two shapes, VS Code's "View as List" / "View as Tree":
 *  - `list` (default) is a flat sequence of file groups, each labelled with its
 *    dimmed directory;
 *  - `tree` nests those groups under directory rows, compressing single-child
 *    directory chains into one row (`server/spa/client`) exactly as VS Code and
 *    the Files view do, so a deep repo does not become a staircase.
 * Directory rows collapse through the same `collapsed` path set as file rows —
 * a path is either a file or a directory, never both, so one set covers both.
 *
 * Two deliberate departures from the old flat list, both for VS Code parity:
 *  - match rows carry no line-number gutter (the line still rides along in
 *    `data-line`, which is what the click-through and the tests read);
 *  - the leading indentation of the line is trimmed off the rendered text, so a
 *    deeply indented hit does not push its own match off the right edge.
 *
 * Headers are no longer sticky: the whole tree scrolls as one surface.
 *
 * The rows are keyboard-navigable as one flat sequence (arrows, Enter, Delete,
 * F4), driven by `flattenVisibleRows` rather than by DOM order — see
 * `useResultKeyboardNav` below.
 *
 * Purely presentational — collapse state is owned by the panel (it lives with
 * the results, so it survives a view switch and resets on the next query).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../../ui/cn';
import type { ContentSearchResultView } from './types';

/** Matches for one file, in line order. */
export interface ContentSearchFileGroup {
    path: string;
    matches: ExplorerContentMatch[];
}

/**
 * Group matches by their file path, preserving the server's ordering: matches
 * arrive sorted by path then line, so the first time a path is seen fixes that
 * file's position in the output.
 */
export function groupMatchesByFile(matches: readonly ExplorerContentMatch[]): ContentSearchFileGroup[] {
    const groups: ContentSearchFileGroup[] = [];
    const byPath = new Map<string, ContentSearchFileGroup>();
    for (const match of matches) {
        let group = byPath.get(match.path);
        if (!group) {
            group = { path: match.path, matches: [] };
            byPath.set(match.path, group);
            groups.push(group);
        }
        group.matches.push(match);
    }
    return groups;
}

/** A directory row in the tree view — holds files and further directories. */
export interface ContentSearchDirNode {
    kind: 'dir';
    /** Repo-relative directory path; the collapse key for this row. */
    path: string;
    /** Row label. A compressed chain reads as `server/spa`, VS Code's shape. */
    name: string;
    /** Matches in this directory and everything under it. */
    matchCount: number;
    children: ContentSearchTreeNode[];
}

/** A file row in the tree view — the same group the list view renders. */
export interface ContentSearchFileNode {
    kind: 'file';
    path: string;
    name: string;
    matches: ExplorerContentMatch[];
}

export type ContentSearchTreeNode = ContentSearchDirNode | ContentSearchFileNode;

/**
 * Nest file groups under their directories, preserving the incoming order (so a
 * directory sits where its first matching file did), then compress single-child
 * directory chains. Pure, and exported so the toolbar's Collapse All and the
 * tests can reason about the same shape the rows render from.
 */
export function buildSearchTree(groups: readonly ContentSearchFileGroup[]): ContentSearchTreeNode[] {
    const roots: ContentSearchTreeNode[] = [];
    const dirs = new Map<string, ContentSearchDirNode>();
    for (const group of groups) {
        const dir = dirName(group.path);
        let siblings = roots;
        let prefix = '';
        for (const segment of dir ? dir.split('/') : []) {
            prefix = prefix ? `${prefix}/${segment}` : segment;
            let node = dirs.get(prefix);
            if (!node) {
                node = { kind: 'dir', path: prefix, name: segment, matchCount: 0, children: [] };
                dirs.set(prefix, node);
                siblings.push(node);
            }
            node.matchCount += group.matches.length;
            siblings = node.children;
        }
        siblings.push({
            kind: 'file',
            path: group.path,
            name: baseName(group.path),
            matches: group.matches,
        });
    }
    return roots.map(compressChains);
}

/**
 * Fold a directory that holds nothing but one more directory into its child, so
 * `src` → `server` → `spa` renders as a single `src/server/spa` row. The
 * surviving row keeps the *deepest* path, which is what the Explorer's other
 * compressed rows do and what makes the collapse key unambiguous.
 */
function compressChains(node: ContentSearchTreeNode): ContentSearchTreeNode {
    if (node.kind !== 'dir') return node;
    let name = node.name;
    let path = node.path;
    let children = node.children.map(compressChains);
    while (children.length === 1 && children[0].kind === 'dir') {
        const only = children[0];
        name = `${name}/${only.name}`;
        path = only.path;
        children = only.children;
    }
    return { kind: 'dir', path, name, matchCount: node.matchCount, children };
}

/**
 * Every path that can be collapsed for a result set: each file, plus each
 * directory row the tree view would draw. Collapse All uses this so one click
 * closes everything in whichever view is showing — the extra directory paths are
 * inert in the list view rather than wrong.
 */
export function collapsibleTreePaths(groups: readonly ContentSearchFileGroup[]): string[] {
    const paths: string[] = [];
    const walk = (nodes: readonly ContentSearchTreeNode[]): void => {
        for (const node of nodes) {
            paths.push(node.path);
            if (node.kind === 'dir') walk(node.children);
        }
    };
    walk(buildSearchTree(groups));
    return paths;
}

/** What a navigable row is: a directory row, a file header, or one match. */
export type ContentSearchRowKind = 'dir' | 'file' | 'match';

/**
 * One row of the flat keyboard sequence. Built from the same walk the renderer
 * does — never from DOM order — so navigation and rendering cannot disagree
 * about what is on screen.
 */
export interface ContentSearchRow {
    kind: ContentSearchRowKind;
    /** Stable identity for focus; unique across a result set. */
    key: string;
    /** The file or directory path; for a match, the path of its file. */
    path: string;
    depth: number;
    /** The row Left-arrow jumps to: a match's file header, a row's parent directory. */
    parentKey: string | null;
    /** Twisty rows only: whether they are currently closed. */
    collapsible: boolean;
    collapsed: boolean;
    /** One-based line, match rows only. */
    line?: number;
    /** Key for `onDismiss`. Absent on directory rows, which are not dismissible. */
    dismissKey?: string;
}

/** Focus keys. Prefixed by kind so a file and its directory can never collide. */
export function dirRowKey(path: string): string {
    return `dir:${path}`;
}

export function fileRowKey(path: string): string {
    return `file:${path}`;
}

export function matchRowKey(match: Pick<ExplorerContentMatch, 'path' | 'line' | 'startColumn'>): string {
    return `match:${match.path}:${match.line}:${match.startColumn}`;
}

/**
 * The rows currently on screen, top to bottom, for whichever layout is showing.
 * Collapsed rows contribute themselves but not their children, which is what
 * makes Up/Down skip a closed group in one step.
 */
export function flattenVisibleRows(
    groups: readonly ContentSearchFileGroup[],
    options: { resultView?: ContentSearchResultView; collapsed?: readonly string[] } = {},
): ContentSearchRow[] {
    const collapsedSet = new Set(options.collapsed ?? []);
    const rows: ContentSearchRow[] = [];

    const pushFile = (group: ContentSearchFileGroup, depth: number, parentKey: string | null): void => {
        const key = fileRowKey(group.path);
        const collapsed = collapsedSet.has(group.path);
        rows.push({
            kind: 'file',
            key,
            path: group.path,
            depth,
            parentKey,
            collapsible: true,
            collapsed,
            dismissKey: group.path,
        });
        if (collapsed) return;
        for (const match of group.matches) {
            rows.push({
                kind: 'match',
                key: matchRowKey(match),
                path: match.path,
                depth,
                parentKey: key,
                collapsible: false,
                collapsed: false,
                line: match.line,
                dismissKey: matchDismissKey(match),
            });
        }
    };

    if (options.resultView !== 'tree') {
        for (const group of groups) pushFile(group, 0, null);
        return rows;
    }

    const walk = (nodes: readonly ContentSearchTreeNode[], depth: number, parentKey: string | null): void => {
        for (const node of nodes) {
            if (node.kind === 'file') {
                pushFile({ path: node.path, matches: node.matches }, depth, parentKey);
                continue;
            }
            const key = dirRowKey(node.path);
            const collapsed = collapsedSet.has(node.path);
            rows.push({
                kind: 'dir',
                key,
                path: node.path,
                depth,
                parentKey,
                collapsible: true,
                collapsed,
            });
            if (!collapsed) walk(node.children, depth + 1, key);
        }
    };
    walk(buildSearchTree(groups), 0, null);
    return rows;
}

/**
 * The row focus should land on after `rows[index]` is dismissed. For a match
 * that is simply the next row; for a file group it is the first row past the
 * group, since the group's own match rows disappear with it. Falls back to the
 * row above, and to nothing when the list empties.
 */
export function rowAfterDismissal(rows: readonly ContentSearchRow[], index: number): string | null {
    const target = rows[index];
    if (!target) return null;
    for (let i = index + 1; i < rows.length; i++) {
        if (target.kind === 'file' && rows[i].path === target.path) continue;
        return rows[i].key;
    }
    return index > 0 ? rows[index - 1].key : null;
}

/**
 * Step to the next (or previous) match row, wrapping at the ends the way
 * VS Code's `F4` does. Only *visible* matches take part — a collapsed group is
 * skipped rather than opened, so `F4` never changes what is on screen.
 */
export function stepToMatch(
    rows: readonly ContentSearchRow[],
    fromIndex: number,
    direction: 1 | -1,
): string | null {
    const count = rows.length;
    if (count === 0) return null;
    const start = fromIndex < 0 ? (direction === 1 ? -1 : count) : fromIndex;
    for (let step = 1; step <= count; step++) {
        const row = rows[((start + direction * step) % count + count) % count];
        if (row.kind === 'match') return row.key;
    }
    return null;
}

/** The three pieces a match row renders: text before, inside, and after the hit. */
export interface MatchTextParts {
    before: string;
    hit: string;
    after: string;
}

/** Split a match's line into the text before, inside, and after the match. */
export function splitMatchText(match: ExplorerContentMatch): MatchTextParts {
    // Columns are UTF-16 offsets into `text` by contract, but clamp anyway so a
    // surprising payload degrades to "no highlight" rather than a blank row.
    const start = Math.max(0, Math.min(match.startColumn, match.text.length));
    const end = Math.max(start, Math.min(match.endColumn, match.text.length));
    return {
        before: match.text.slice(0, start),
        hit: match.text.slice(start, end),
        after: match.text.slice(end),
    };
}

/**
 * Drop the line's leading indentation for display. Only the `before` segment is
 * touched, so a query that matches whitespace still highlights exactly what the
 * searcher matched — worst case the indentation the user searched for survives
 * inside `hit`.
 */
export function trimMatchIndent(parts: MatchTextParts): MatchTextParts {
    return { ...parts, before: parts.before.replace(/^[ \t]+/, '') };
}

/**
 * Add or remove one path from the collapsed set, returning a new array. Kept
 * pure and exported so the toolbar's Collapse All and the header twisty share
 * one notion of the state's shape.
 */
export function toggleCollapsedPath(collapsed: readonly string[], path: string): string[] {
    return collapsed.includes(path)
        ? collapsed.filter(entry => entry !== path)
        : [...collapsed, path];
}

/**
 * The key a match row is dismissed under. `\u0000` cannot appear in a repo path,
 * so a match key can never collide with the file path a whole group is dismissed
 * under, and `line:startColumn` is unique within a file.
 */
export function matchDismissKey(match: Pick<ExplorerContentMatch, 'path' | 'line' | 'startColumn'>): string {
    return `${match.path}\u0000${match.line}:${match.startColumn}`;
}

/**
 * Drop the matches the user dismissed — whole files first (the group key is the
 * bare path), then individual rows. A file whose every match is dismissed simply
 * stops producing a group, which is how "dismissing the last match removes the
 * group" falls out without a special case.
 *
 * Returns the input array untouched when nothing is dismissed, so the common
 * case adds no allocation and memoized consumers do not re-run.
 */
export function applyDismissals(
    matches: readonly ExplorerContentMatch[],
    dismissed: readonly string[],
): readonly ExplorerContentMatch[] {
    if (dismissed.length === 0) return matches;
    const keys = new Set(dismissed);
    return matches.filter(match => !keys.has(match.path) && !keys.has(matchDismissKey(match)));
}

/** Add one key to the dismissed set, ignoring a repeat. */
export function dismissRow(dismissed: readonly string[], key: string): string[] {
    return dismissed.includes(key) ? [...dismissed] : [...dismissed, key];
}

/** Last path segment, used as the file name in the group header. */
function baseName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? path : path.slice(index + 1);
}

function dirName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
}

/** Row indentation in pixels for a nesting depth; depth 0 matches the old `px-2`. */
const INDENT_STEP_PX = 12;
const HEADER_BASE_PX = 8;
const MATCH_BASE_PX = 28;

const ROW_CLASS = cn(
    'w-full flex items-baseline gap-1.5 pr-2 py-1 text-xs text-left',
    'bg-transparent border-none cursor-pointer',
    'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]',
);

export interface ContentSearchResultsProps {
    groups: ContentSearchFileGroup[];
    /** Called with the repo-relative path and the one-based line of the hit. */
    onOpenMatch: (path: string, line: number) => void;
    /** Paths whose matches are hidden. Absent means every group is expanded. */
    collapsed?: readonly string[];
    /** Toggle one group open/closed. Absent leaves the twisty inert. */
    onToggleCollapsed?: (path: string) => void;
    /** Flat-by-file (default) or nested by directory. */
    resultView?: ContentSearchResultView;
    /**
     * Hide one row: a file path dismisses the whole group, a `matchDismissKey`
     * dismisses one match. Absent hides the `X` affordance entirely.
     */
    onDismiss?: (key: string) => void;
    /**
     * Rewrite the given matches with the panel's current replacement. Passed
     * the whole group's matches from a file header, one match from a match row.
     * Absent hides the replace affordance — which is what a collapsed or
     * unusable replace row means.
     */
    onReplace?: (matches: readonly ExplorerContentMatch[]) => void;
}

interface RowProps {
    collapsedSet: ReadonlySet<string>;
    onToggleCollapsed?: (path: string) => void;
    onOpenMatch: (path: string, line: number) => void;
    /** Hide one row. Absent leaves the `X` affordance off entirely. */
    onDismiss?: (key: string) => void;
    /** Rewrite matches. Absent leaves the replace affordance off entirely. */
    onReplace?: (matches: readonly ExplorerContentMatch[]) => void;
    /**
     * Roving tabindex: exactly one row is tabbable, so Tab lands on the results
     * once and the arrow keys take over from there.
     */
    tabbableKey: string | null;
    /** Remember a row's element so navigation can move focus onto it. */
    registerRow: (key: string, el: HTMLButtonElement | null) => void;
    /** A row taking focus (a click, or Tab) becomes the navigation anchor. */
    onRowFocus: (key: string) => void;
}

/** The props every focusable row button shares. */
function rowFocusProps(key: string, rows: RowProps) {
    return {
        ref: (el: HTMLButtonElement | null) => rows.registerRow(key, el),
        onFocus: () => rows.onRowFocus(key),
        tabIndex: rows.tabbableKey === key ? 0 : -1,
        'data-row-key': key,
    };
}

/**
 * The hover-only `X` that hides a row. It sits *beside* the row button rather
 * than inside it: a button inside a button is invalid markup, and React would
 * hand the click to both.
 */
function DismissButton({ label, onDismiss }: { label: string; onDismiss: () => void }) {
    return (
        <button
            type="button"
            onClick={onDismiss}
            className={cn(
                'flex-shrink-0 px-1 text-xs leading-none text-[#848484]',
                'bg-transparent border-none cursor-pointer',
                'opacity-0 group-hover:opacity-100 focus:opacity-100',
                'hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
            )}
            title={label}
            aria-label={label}
            data-testid="content-search-dismiss"
        >
            ✕
        </button>
    );
}

/**
 * The hover-only replace action, beside the dismiss `X` and outside the row
 * button for the same reason. Shown only while the panel says replacing is
 * possible, so it never offers a write the endpoint would refuse.
 */
function ReplaceButton({ label, onReplace }: { label: string; onReplace: () => void }) {
    return (
        <button
            type="button"
            onClick={onReplace}
            className={cn(
                'flex-shrink-0 px-1 text-xs leading-none text-[#848484]',
                'bg-transparent border-none cursor-pointer',
                'opacity-0 group-hover:opacity-100 focus:opacity-100',
                'hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
            )}
            title={label}
            aria-label={label}
            data-testid="content-search-replace-action"
        >
            ⇄
        </button>
    );
}

function Twisty({ collapsed }: { collapsed: boolean }) {
    return (
        <span
            className="flex-shrink-0 w-3 text-[#848484] leading-none"
            aria-hidden="true"
            data-testid="content-search-twisty"
        >
            {collapsed ? '▸' : '▾'}
        </span>
    );
}

function CountBadge({ count }: { count: number }) {
    return (
        <span className="text-[#848484] flex-shrink-0" data-testid="content-search-file-count">
            {count}
        </span>
    );
}

/** One file group: its header row plus, when expanded, its match rows. */
function FileGroupRows(props: RowProps & {
    path: string;
    name: string;
    /** Dimmed directory suffix — empty in the tree view, where it is redundant. */
    directory: string;
    matches: ExplorerContentMatch[];
    depth: number;
}) {
    const { path, name, directory, matches, depth, collapsedSet, onToggleCollapsed, onOpenMatch, onDismiss, onReplace } = props;
    const rowProps: RowProps = props;
    const isCollapsed = collapsedSet.has(path);
    return (
        <div data-testid="content-search-group" data-path={path}>
            <div className="group flex items-center">
                <button
                    type="button"
                    {...rowFocusProps(fileRowKey(path), rowProps)}
                    onClick={() => onToggleCollapsed?.(path)}
                    className={cn(ROW_CLASS, 'flex-1 min-w-0')}
                    style={{ paddingLeft: HEADER_BASE_PX + depth * INDENT_STEP_PX }}
                    data-testid="content-search-file-header"
                    data-path={path}
                    data-collapsed={isCollapsed ? 'true' : 'false'}
                    aria-expanded={!isCollapsed}
                    title={path}
                >
                    <Twisty collapsed={isCollapsed} />
                    <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">{name}</span>
                    <span className="text-[#848484] truncate flex-1 min-w-0">{directory}</span>
                    <CountBadge count={matches.length} />
                </button>
                {onReplace && (
                    <ReplaceButton label={`Replace in ${path}`} onReplace={() => onReplace(matches)} />
                )}
                {onDismiss && (
                    <DismissButton label={`Dismiss ${path}`} onDismiss={() => onDismiss(path)} />
                )}
            </div>
            {!isCollapsed && matches.map(match => {
                const { before, hit, after } = trimMatchIndent(splitMatchText(match));
                return (
                    <div key={`${match.line}:${match.startColumn}`} className="group flex items-center">
                        <button
                            type="button"
                            {...rowFocusProps(matchRowKey(match), rowProps)}
                            onClick={() => onOpenMatch(match.path, match.line)}
                            className={cn(
                                'flex-1 min-w-0 flex items-baseline gap-2 pr-3 py-0.5 text-left text-xs font-mono',
                                'bg-transparent border-none cursor-pointer',
                                'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]',
                            )}
                            style={{ paddingLeft: MATCH_BASE_PX + depth * INDENT_STEP_PX }}
                            data-testid="content-search-match"
                            data-path={match.path}
                            data-line={match.line}
                        >
                            {/* Long lines scroll horizontally inside their own row rather
                                than stretching the panel; the highlight stays inline. */}
                            <span className="flex-1 min-w-0 overflow-x-auto whitespace-pre text-[#1e1e1e] dark:text-[#cccccc]">
                                {before}
                                <mark className="bg-[#fff2a8] dark:bg-[#623315] text-inherit rounded-sm">
                                    {hit}
                                </mark>
                                {after}
                            </span>
                        </button>
                        {onReplace && (
                            <ReplaceButton
                                label={`Replace match at line ${match.line}`}
                                onReplace={() => onReplace([match])}
                            />
                        )}
                        {onDismiss && (
                            <DismissButton
                                label={`Dismiss match at line ${match.line}`}
                                onDismiss={() => onDismiss(matchDismissKey(match))}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function TreeRows({ nodes, depth, ...rows }: RowProps & {
    nodes: readonly ContentSearchTreeNode[];
    depth: number;
}) {
    return (
        <>
            {nodes.map(node => {
                if (node.kind === 'file') {
                    return (
                        <FileGroupRows
                            key={node.path}
                            path={node.path}
                            name={node.name}
                            directory=""
                            matches={node.matches}
                            depth={depth}
                            {...rows}
                        />
                    );
                }
                const isCollapsed = rows.collapsedSet.has(node.path);
                return (
                    <div key={node.path} data-testid="content-search-dir" data-path={node.path}>
                        <button
                            type="button"
                            {...rowFocusProps(dirRowKey(node.path), rows)}
                            onClick={() => rows.onToggleCollapsed?.(node.path)}
                            className={ROW_CLASS}
                            style={{ paddingLeft: HEADER_BASE_PX + depth * INDENT_STEP_PX }}
                            data-testid="content-search-dir-header"
                            data-path={node.path}
                            data-collapsed={isCollapsed ? 'true' : 'false'}
                            aria-expanded={!isCollapsed}
                            title={node.path}
                        >
                            <Twisty collapsed={isCollapsed} />
                            <span className="text-[#1e1e1e] dark:text-[#cccccc] truncate flex-1 min-w-0 text-left">
                                {node.name}
                            </span>
                            <CountBadge count={node.matchCount} />
                        </button>
                        {!isCollapsed && (
                            <TreeRows nodes={node.children} depth={depth + 1} {...rows} />
                        )}
                    </div>
                );
            })}
        </>
    );
}

/**
 * `useResultKeyboardNav` — the flat arrow/Enter/Delete/F4 sequence over the rows
 * currently on screen.
 *
 * The navigable order comes from `flattenVisibleRows`, not from the DOM, because
 * the list and tree layouts render through two different code paths and only the
 * derived list can describe both. Focus itself is moved imperatively through a
 * key → element map: after expanding a group or dismissing a row the target row
 * does not exist yet at the time the key is handled, so the move is deferred to
 * the effect that runs once React has painted the new rows.
 */
function useResultKeyboardNav({
    rows,
    onOpenMatch,
    onToggleCollapsed,
    onDismiss,
}: {
    rows: readonly ContentSearchRow[];
    onOpenMatch: (path: string, line: number) => void;
    onToggleCollapsed?: (path: string) => void;
    onDismiss?: (key: string) => void;
}) {
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const elements = useRef(new Map<string, HTMLButtonElement>());
    const pendingFocus = useRef<string | null>(null);

    const registerRow = useCallback((key: string, el: HTMLButtonElement | null) => {
        if (el) elements.current.set(key, el);
        else elements.current.delete(key);
    }, []);

    // Focusing an already-focused element is a no-op, so letting a row's own
    // `onFocus` write the anchor back cannot loop with the effect below.
    const onRowFocus = useCallback((key: string) => setActiveKey(key), []);

    useEffect(() => {
        const key = pendingFocus.current;
        if (key === null) return;
        pendingFocus.current = null;
        elements.current.get(key)?.focus();
    });

    // A row can vanish under the cursor (dismissed, or its group collapsed);
    // drop the stale anchor so the roving tabindex falls back to the first row.
    useEffect(() => {
        if (activeKey !== null && !rows.some(row => row.key === activeKey)) setActiveKey(null);
    }, [rows, activeKey]);

    const focusKey = useCallback((key: string | null) => {
        if (key === null) return;
        setActiveKey(key);
        pendingFocus.current = key;
    }, []);

    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (rows.length === 0) return;
        const index = activeKey === null ? -1 : rows.findIndex(row => row.key === activeKey);
        const current = index < 0 ? null : rows[index];
        const last = rows.length - 1;

        switch (event.key) {
            case 'ArrowDown':
                focusKey(rows[index < 0 ? 0 : Math.min(index + 1, last)].key);
                break;
            case 'ArrowUp':
                focusKey(rows[index < 0 ? last : Math.max(index - 1, 0)].key);
                break;
            case 'ArrowLeft':
                if (!current) return;
                // An open group closes in place; anything else walks outward, so
                // a second press on a closed group still moves up a level.
                if (current.collapsible && !current.collapsed) onToggleCollapsed?.(current.path);
                else focusKey(current.parentKey);
                break;
            case 'ArrowRight':
                if (!current) return;
                if (current.collapsible && current.collapsed) onToggleCollapsed?.(current.path);
                else if (index < last) focusKey(rows[index + 1].key);
                break;
            case 'Enter':
                if (!current) return;
                // Handled here rather than left to the button's native activation
                // so the two can never both fire; `preventDefault` suppresses it.
                if (current.kind === 'match' && current.line !== undefined) onOpenMatch(current.path, current.line);
                else onToggleCollapsed?.(current.path);
                break;
            case 'Delete':
                if (!current?.dismissKey || !onDismiss) return;
                focusKey(rowAfterDismissal(rows, index));
                onDismiss(current.dismissKey);
                break;
            case 'F4':
                focusKey(stepToMatch(rows, index, event.shiftKey ? -1 : 1));
                break;
            default:
                return;
        }
        event.preventDefault();
    }, [rows, activeKey, focusKey, onOpenMatch, onToggleCollapsed, onDismiss]);

    return {
        onKeyDown,
        registerRow,
        onRowFocus,
        // With nothing focused yet, Tab must still reach the results: the first
        // row carries the tab stop until the user picks another.
        tabbableKey: activeKey ?? rows[0]?.key ?? null,
    };
}

export function ContentSearchResults({
    groups,
    onOpenMatch,
    collapsed,
    onToggleCollapsed,
    resultView = 'list',
    onDismiss,
    onReplace,
}: ContentSearchResultsProps) {
    const navRows = useMemo(
        () => flattenVisibleRows(groups, { resultView, collapsed }),
        [groups, resultView, collapsed],
    );
    const { onKeyDown, ...focus } = useResultKeyboardNav({
        rows: navRows,
        onOpenMatch,
        onToggleCollapsed,
        onDismiss,
    });
    const rows: RowProps = {
        collapsedSet: new Set(collapsed ?? []),
        onToggleCollapsed,
        onOpenMatch,
        onDismiss,
        onReplace,
        ...focus,
    };
    return (
        <div
            className="flex-1 min-h-0 overflow-y-auto"
            data-testid="content-search-results"
            data-result-view={resultView}
            onKeyDown={onKeyDown}
        >
            {resultView === 'tree'
                ? <TreeRows nodes={buildSearchTree(groups)} depth={0} {...rows} />
                : groups.map(group => (
                    <FileGroupRows
                        key={group.path}
                        path={group.path}
                        name={baseName(group.path)}
                        directory={dirName(group.path)}
                        matches={group.matches}
                        depth={0}
                        {...rows}
                    />
                ))}
        </div>
    );
}
