/**
 * FileMentionMenu — autocomplete dropdown for file-path mentions in the chat
 * composer (AC-02).
 *
 * Rows come from `useFileMentionSearch`, already merged and ranked across every
 * repo in the group, so each row carries its own repo label. The Rust scorer's
 * match `indices` are highlighted with the same helpers `QuickOpen` uses, which
 * keeps "fuzzy file search" looking identical wherever it appears.
 *
 * Like `RepoMentionMenu` this component is deliberately dumb: it renders the
 * list and reports clicks. Selection state and the keyboard chain live in the
 * composer, because the file popup must sit *after* the `/`, model, and `#repo`
 * menus in key precedence (AC-05) and only the composer knows that order.
 */

import { useEffect, useRef } from 'react';
import { cn } from '../../ui/cn';
import { highlightMatches, splitIndices } from '../repo-detail/explorer/QuickOpen';
import type { FileMentionResult } from './hooks/useFileMentionSearch';

export interface FileMentionMenuProps {
    results: FileMentionResult[];
    onSelect: (result: FileMentionResult) => void;
    onDismiss: () => void;
    visible: boolean;
    highlightIndex: number;
}

/**
 * Next highlighted row for an Arrow key, wrapping at both ends.
 *
 * Exported as a pure helper so the composer's key chain and the menu's own
 * tests move the selection the same way — the menu itself holds no state.
 */
export function moveFileMentionHighlight(
    index: number,
    count: number,
    key: 'ArrowDown' | 'ArrowUp',
): number {
    if (count <= 0) return 0;
    const delta = key === 'ArrowDown' ? 1 : -1;
    return (index + delta + count) % count;
}

function fileName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? p : p.slice(idx + 1);
}

function dirName(p: string): string {
    const idx = p.lastIndexOf('/');
    return idx < 0 ? '' : p.slice(0, idx);
}

/** File glyph, sized to match the 11px icons in the sibling composer menus. */
function FileIcon({ className }: { className?: string }) {
    return (
        <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={cn('shrink-0', className)}
        >
            <path
                d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
            <path d="M9 1.5V5.5H13" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
    );
}

export function FileMentionMenu({
    results,
    onSelect,
    onDismiss,
    visible,
    highlightIndex,
}: FileMentionMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!visible) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onDismiss();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [visible, onDismiss]);

    useEffect(() => {
        if (!visible || !menuRef.current) return;
        const items = menuRef.current.querySelectorAll('[data-menu-item]');
        const item = items[highlightIndex] as HTMLElement | undefined;
        item?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex, visible]);

    if (!visible || results.length === 0) return null;

    return (
        <div
            ref={menuRef}
            className={cn(
                'absolute z-[10000] py-0.5 rounded-md shadow-lg overflow-y-auto',
                'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                'max-h-48',
            )}
            style={{
                bottom: '100%',
                marginBottom: '4px',
                left: 0,
                minWidth: 260,
                maxWidth: 520,
            }}
            role="listbox"
            aria-label="Insert a file path"
            data-testid="file-mention-menu"
        >
            {results.map((result, i) => {
                const isHighlighted = i === highlightIndex;
                const matched = splitIndices(result.path, result.indices ?? []);
                const dir = dirName(result.path);
                return (
                    <button
                        key={`${result.workspaceId}:${result.path}`}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        data-menu-item
                        data-testid={`file-mention-item-${i}`}
                        className={cn(
                            'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] cursor-pointer transition-colors min-w-0',
                            isHighlighted
                                ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                        )}
                        onMouseDown={e => { e.preventDefault(); onSelect(result); }}
                    >
                        <FileIcon className="text-[#848484] dark:text-[#999]" />
                        <span
                            className="font-medium leading-tight truncate"
                            data-testid={`file-mention-name-${i}`}
                        >
                            {highlightMatches(fileName(result.path), matched.name)}
                        </span>
                        {dir && (
                            <span
                                className="text-[10px] text-[#848484] dark:text-[#999] truncate min-w-0"
                                data-testid={`file-mention-dir-${i}`}
                            >
                                {highlightMatches(dir, matched.dir)}
                            </span>
                        )}
                        <span
                            className="ml-auto text-[10px] text-[#848484] dark:text-[#999] shrink-0"
                            data-testid={`file-mention-repo-${i}`}
                        >
                            {result.repoName}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
