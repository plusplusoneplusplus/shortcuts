/**
 * ContentSearchResults — renders content-search hits grouped by file.
 *
 * One header row per file (repo-relative path + its match count), and under it
 * one row per match showing the line number and the matching line with the
 * matched span highlighted. Clicking a match asks the owner to open that file at
 * that line.
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

/** Split a match's line into the text before, inside, and after the match. */
export function splitMatchText(match: ExplorerContentMatch): { before: string; hit: string; after: string } {
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

/** Last path segment, used as the file name in the group header. */
function baseName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? path : path.slice(index + 1);
}

/** Everything before the last path segment. */
function dirName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
}

export interface ContentSearchResultsProps {
    groups: ContentSearchFileGroup[];
    /** Called with the repo-relative path and the one-based line of the hit. */
    onOpenMatch: (path: string, line: number) => void;
}

export function ContentSearchResults({ groups, onOpenMatch }: ContentSearchResultsProps) {
    return (
        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="content-search-results">
            {groups.map(group => (
                <div key={group.path} data-testid="content-search-group" data-path={group.path}>
                    <div
                        className="flex items-baseline gap-1.5 px-3 py-1 text-xs sticky top-0 bg-[#f3f3f3] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="content-search-file-header"
                        data-path={group.path}
                        title={group.path}
                    >
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
                    </div>
                    {group.matches.map(match => {
                        const { before, hit, after } = splitMatchText(match);
                        return (
                            <button
                                key={`${match.line}:${match.startColumn}`}
                                type="button"
                                onClick={() => onOpenMatch(match.path, match.line)}
                                className={cn(
                                    'w-full flex items-baseline gap-2 px-3 py-0.5 text-left text-xs font-mono',
                                    'bg-transparent border-none cursor-pointer',
                                    'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]',
                                )}
                                data-testid="content-search-match"
                                data-path={match.path}
                                data-line={match.line}
                            >
                                <span className="text-[#848484] tabular-nums flex-shrink-0 w-10 text-right">
                                    {match.line}
                                </span>
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
            ))}
        </div>
    );
}
