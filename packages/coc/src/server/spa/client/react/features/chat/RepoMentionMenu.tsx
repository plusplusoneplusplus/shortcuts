/**
 * RepoMentionMenu — autocomplete dropdown for `#repo_name` mentions in a
 * repo-group chat composer.
 *
 * Purely a typing convenience: picking a row inserts the plain text
 * `#<name> ` into the prompt. Nothing about the message payload, routing, or
 * repo scoping changes — see `RepoMentionMenuProps.onSelect`.
 *
 * Visual style and keyboard model mirror `ModelCommandMenu` so the three
 * composer popovers (`/`, model picker, `#`) read as one family.
 */

import { useEffect, useRef } from 'react';
import { cn } from '../../ui/cn';
import type { RepoGroupMember } from '../../repos/repoGroupService';

export interface RepoMentionMenuProps {
    members: RepoGroupMember[];
    onSelect: (name: string) => void;
    onDismiss: () => void;
    visible: boolean;
    highlightIndex: number;
}

/**
 * Filter group members for the `#` picker.
 *
 * Case-insensitive substring match on the member `name`, matching how
 * `filterModels` treats the model list. Members whose workspace was removed
 * from the registry have no `name` and are dropped — there is nothing to
 * insert for them.
 */
export function filterRepoMembers(members: RepoGroupMember[], prefix: string): RepoGroupMember[] {
    const named = members.filter(m => !!m.name);
    if (!prefix) return named;
    const lc = prefix.toLowerCase();
    return named.filter(m => m.name!.toLowerCase().includes(lc));
}

/** Repository glyph — a small folder/branch mark, matching the menu's 11px icons. */
function RepoIcon({ className }: { className?: string }) {
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
                d="M2 3.5A1.5 1.5 0 0 1 3.5 2h7A1.5 1.5 0 0 1 12 3.5V14l-4.25-2.25L3.5 14V3.5Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function RepoMentionMenu({
    members,
    onSelect,
    onDismiss,
    visible,
    highlightIndex,
}: RepoMentionMenuProps) {
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

    if (!visible || members.length === 0) return null;

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
                minWidth: 220,
                maxWidth: 480,
            }}
            role="listbox"
            aria-label="Mention a repo in this group"
            data-testid="repo-mention-menu"
        >
            {members.map((member, i) => {
                const isHighlighted = i === highlightIndex;
                return (
                    <button
                        key={member.workspaceId}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        data-menu-item
                        data-testid={`repo-mention-item-${member.name}`}
                        className={cn(
                            'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] cursor-pointer transition-colors min-w-0',
                            isHighlighted
                                ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                        )}
                        onMouseDown={e => { e.preventDefault(); onSelect(member.name!); }}
                    >
                        <RepoIcon className="text-[#848484] dark:text-[#999]" />
                        <span className="font-medium leading-tight truncate">{member.name}</span>
                        {member.stale && (
                            // Same wording the group Settings tab uses for a member
                            // whose workspace or path went away.
                            <span
                                className="text-[10px] font-medium text-[#b58900] dark:text-[#d7ba7d] shrink-0"
                                data-testid="repo-mention-stale"
                            >
                                stale
                            </span>
                        )}
                        {member.description && (
                            <span className="text-[10px] text-[#848484] dark:text-[#999] truncate min-w-0">
                                {member.description}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
