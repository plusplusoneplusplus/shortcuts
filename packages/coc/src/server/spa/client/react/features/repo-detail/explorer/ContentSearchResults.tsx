/**
 * ContentSearchResults — renders content-search hits as a collapsible tree,
 * grouped by file, the way VS Code's Search side bar does.
 *
 * One header row per file (twisty + file name + dimmed directory + match count),
 * and under it one row per match showing the matching line with the matched span
 * highlighted. Clicking a match asks the owner to open that file at that line.
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

/** Last path segment, used as the file name in the group header. */
function baseName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? path : path.slice(index + 1);
}

function dirName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
}

export interface ContentSearchResultsProps {
    groups: ContentSearchFileGroup[];
    /** Called with the repo-relative path and the one-based line of the hit. */
    onOpenMatch: (path: string, line: number) => void;
    /** Paths whose matches are hidden. Absent means every group is expanded. */
    collapsed?: readonly string[];
    /** Toggle one group open/closed. Absent leaves the twisty inert. */
    onToggleCollapsed?: (path: string) => void;
}

export function ContentSearchResults({
    groups,
    onOpenMatch,
    collapsed,
    onToggleCollapsed,
}: ContentSearchResultsProps) {
    const collapsedSet = new Set(collapsed ?? []);
    return (
        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="content-search-results">
            {groups.map(group => {
                const isCollapsed = collapsedSet.has(group.path);
                return (
                    <div key={group.path} data-testid="content-search-group" data-path={group.path}>
                        <button
                            type="button"
                            onClick={() => onToggleCollapsed?.(group.path)}
                            className={cn(
                                'w-full flex items-baseline gap-1.5 px-2 py-1 text-xs text-left',
                                'bg-transparent border-none cursor-pointer',
                                'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]',
                            )}
                            data-testid="content-search-file-header"
                            data-path={group.path}
                            data-collapsed={isCollapsed ? 'true' : 'false'}
                            aria-expanded={!isCollapsed}
                            title={group.path}
                        >
                            <span
                                className="flex-shrink-0 w-3 text-[#848484] leading-none"
                                aria-hidden="true"
                                data-testid="content-search-twisty"
                            >
                                {isCollapsed ? '▸' : '▾'}
                            </span>
                            <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                {baseName(group.path)}
                            </span>
                            <span className="text-[#848484] truncate flex-1 min-w-0">{dirName(group.path)}</span>
                            <span
                                className="text-[#848484] flex-shrink-0"
                                data-testid="content-search-file-count"
                            >
                                {group.matches.length}
                            </span>
                        </button>
                        {!isCollapsed && group.matches.map(match => {
                            const { before, hit, after } = trimMatchIndent(splitMatchText(match));
                            return (
                                <button
                                    key={`${match.line}:${match.startColumn}`}
                                    type="button"
                                    onClick={() => onOpenMatch(match.path, match.line)}
                                    className={cn(
                                        'w-full flex items-baseline gap-2 pl-7 pr-3 py-0.5 text-left text-xs font-mono',
                                        'bg-transparent border-none cursor-pointer',
                                        'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]',
                                    )}
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
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
