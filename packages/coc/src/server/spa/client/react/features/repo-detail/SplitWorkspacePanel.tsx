import type { ReactNode } from 'react';
import { cn } from '../../ui';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';

/**
 * Layout shell for the split "Workspace" view (behind the `splitWorkspacePanel`
 * flag). It arranges three content slots — the chat list (top-left), the git
 * list (bottom-left) and ONE shared detail pane (right) — and owns nothing but
 * the layout: a horizontal divider that rebalances the two left halves and a
 * vertical divider that resizes the whole left column. Both sizes persist
 * per-workspace via `useResizablePanel`'s `storageKey` (AC-06). The slots are
 * filled by the reused `RepoChatTab` / `RepoGitTab` components — this shell adds
 * no chat/git logic of its own (reuse constraint).
 *
 * At narrow (mobile) widths it collapses to a single scrolling column and drops
 * the dividers, deferring to each tab's existing single-column behavior (AC-07).
 */
export interface SplitWorkspacePanelProps {
    /** Scopes the persisted layout keys so each workspace keeps its own sizes. */
    workspaceId: string;
    /** Chat list surface (top-left half). */
    chatList: ReactNode;
    /** Git list surface (bottom-left half). */
    gitList: ReactNode;
    /** The single shared detail pane (right); reflects the last-clicked item. */
    detail: ReactNode;
}

/** localStorage key for the left column's overall width, per workspace. */
export function splitWorkspaceWidthStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:left-width`;
}

/** localStorage key for the chat/git divider ratio (chat half height), per workspace. */
export function splitWorkspaceDividerStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:chat-height`;
}

const DIVIDER_CLASS =
    'flex items-center justify-center hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0';

export function SplitWorkspacePanel({ workspaceId, chatList, gitList, detail }: SplitWorkspacePanelProps) {
    const { isMobile } = useBreakpoint();

    // Vertical divider between the chat (top) and git (bottom) halves. The chat
    // half is a top-anchored panel whose height is the persisted "ratio".
    const chatHalf = useResizablePanel({
        direction: 'top',
        initialWidth: 320,
        minWidth: 120,
        maxWidth: 800,
        storageKey: splitWorkspaceDividerStorageKey(workspaceId),
    });

    // Horizontal divider setting the whole left column's width.
    const leftColumn = useResizablePanel({
        direction: 'left',
        initialWidth: 360,
        minWidth: 240,
        maxWidth: 640,
        storageKey: splitWorkspaceWidthStorageKey(workspaceId),
    });

    // Narrow / mobile fallback: single scrolling column, no split, no dividers.
    // Each reused tab keeps its own single-column behavior; we just stack the
    // slots so the split + detail never render side-by-side on a small screen.
    if (isMobile) {
        return (
            <div
                className="split-workspace-panel flex flex-col h-full w-full overflow-y-auto"
                data-testid="split-workspace-panel"
                data-narrow="true"
            >
                <div className="min-h-0" data-testid="split-workspace-chat">{chatList}</div>
                <div className="min-h-0" data-testid="split-workspace-git">{gitList}</div>
                <div className="min-h-0" data-testid="split-workspace-detail">{detail}</div>
            </div>
        );
    }

    return (
        <div
            className="split-workspace-panel flex h-full w-full overflow-hidden"
            data-testid="split-workspace-panel"
        >
            {/* LEFT COLUMN — chat list (top) + git list (bottom), fixed width. */}
            <div
                className="flex flex-col min-h-0 overflow-hidden flex-shrink-0 border-r border-[#e5e5e5] dark:border-[#333]"
                style={{ width: leftColumn.width }}
                data-testid="split-workspace-left"
            >
                {/* TOP — chat list, resizable height. */}
                <div
                    className="min-h-0 overflow-hidden flex-shrink-0"
                    style={{ height: chatHalf.width }}
                    data-testid="split-workspace-chat"
                >
                    {chatList}
                </div>

                {/* Divider between chat and git — drag up/down to rebalance. */}
                <div
                    className={cn(DIVIDER_CLASS, 'h-1 cursor-row-resize')}
                    onMouseDown={chatHalf.handleMouseDown}
                    onTouchStart={chatHalf.handleTouchStart}
                    data-testid="split-workspace-divider"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize chat and git panels"
                    tabIndex={0}
                />

                {/* BOTTOM — git list, fills the remaining height. */}
                <div className="flex-1 min-h-0 overflow-hidden" data-testid="split-workspace-git">
                    {gitList}
                </div>
            </div>

            {/* Divider between the left column and the detail pane. */}
            <div
                className={cn(DIVIDER_CLASS, 'w-1 cursor-col-resize')}
                onMouseDown={leftColumn.handleMouseDown}
                onTouchStart={leftColumn.handleTouchStart}
                data-testid="split-workspace-width-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize left panel width"
                tabIndex={0}
            />

            {/* RIGHT — the single shared detail pane (last-clicked item). */}
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden" data-testid="split-workspace-detail">
                {detail}
            </div>
        </div>
    );
}
