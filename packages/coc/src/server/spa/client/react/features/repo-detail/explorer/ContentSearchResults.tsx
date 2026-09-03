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
 * Purely presentational — collapse state is owned by the panel (it lives with
 * the results, so it survives a view switch and resets on the next query).
 */

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
}

interface RowProps {
    collapsedSet: ReadonlySet<string>;
    onToggleCollapsed?: (path: string) => void;
    onOpenMatch: (path: string, line: number) => void;
    /** Hide one row. Absent leaves the `X` affordance off entirely. */
    onDismiss?: (key: string) => void;
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
function FileGroupRows({
    path,
    name,
    directory,
    matches,
    depth,
    collapsedSet,
    onToggleCollapsed,
    onOpenMatch,
    onDismiss,
}: RowProps & {
    path: string;
    name: string;
    /** Dimmed directory suffix — empty in the tree view, where it is redundant. */
    directory: string;
    matches: ExplorerContentMatch[];
    depth: number;
}) {
    const isCollapsed = collapsedSet.has(path);
    return (
        <div data-testid="content-search-group" data-path={path}>
            <div className="group flex items-center">
                <button
                    type="button"
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

export function ContentSearchResults({
    groups,
    onOpenMatch,
    collapsed,
    onToggleCollapsed,
    resultView = 'list',
    onDismiss,
}: ContentSearchResultsProps) {
    const rows: RowProps = {
        collapsedSet: new Set(collapsed ?? []),
        onToggleCollapsed,
        onOpenMatch,
        onDismiss,
    };
    return (
        <div
            className="flex-1 min-h-0 overflow-y-auto"
            data-testid="content-search-results"
            data-result-view={resultView}
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
