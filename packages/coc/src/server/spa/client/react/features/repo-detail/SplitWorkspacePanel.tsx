import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * Each left half sits under a compact VS Code-style section header. Clicking a
 * header collapses that half to just its header bar; the other half then grows
 * to fill the freed vertical space (the chat/git resize divider only shows when
 * both halves are expanded). Collapsed state persists per-workspace too. The
 * collapsed body stays mounted (hidden) so its scroll/selection survive a
 * collapse round-trip.
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
    /** Label for the chat section header. Defaults to `Chat`. */
    chatLabel?: string;
    /** Label for the git section header. Defaults to `Git`. */
    gitLabel?: string;
}

/** localStorage key for the left column's overall width, per workspace. */
export function splitWorkspaceWidthStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:left-width`;
}

/** localStorage key for the chat/git divider ratio (chat half height), per workspace. */
export function splitWorkspaceDividerStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:chat-height`;
}

/** localStorage key for whether the chat half is collapsed, per workspace. */
export function splitWorkspaceChatCollapsedStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:chat-collapsed`;
}

/** localStorage key for whether the git half is collapsed, per workspace. */
export function splitWorkspaceGitCollapsedStorageKey(workspaceId: string): string {
    return `split-workspace:${workspaceId}:git-collapsed`;
}

const DIVIDER_CLASS =
    'group relative flex items-center justify-center hover:bg-[#007acc]/15 active:bg-[#007acc]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/40 transition-colors flex-shrink-0';

const CHAT_SPLIT_MIN_HEIGHT = 120;
const CHAT_SPLIT_MAX_HEIGHT = 800;
const CHAT_SPLIT_INITIAL_HEIGHT = 320;
const LEFT_COLUMN_MIN_WIDTH = 240;
const LEFT_COLUMN_MAX_WIDTH = 640;
const LEFT_COLUMN_INITIAL_WIDTH = 360;

function readCollapsed(storageKey: string): boolean {
    try {
        return localStorage.getItem(storageKey) === '1';
    } catch {
        return false;
    }
}

/**
 * Persisted collapsed flag for a section, scoped by `storageKey`. Only writes on
 * an explicit user toggle (never on mount or on a workspace switch), so a
 * workspace with no collapse history keeps a clean localStorage. Re-syncs when
 * the key changes (workspace switch).
 */
function useCollapsedState(storageKey: string): [boolean, () => void] {
    const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));
    // Suppress the persist effect for the initial value and for values loaded on
    // a workspace switch — those are reads, not user intent.
    const skipPersistRef = useRef(true);

    useEffect(() => {
        skipPersistRef.current = true;
        setCollapsed(readCollapsed(storageKey));
    }, [storageKey]);

    useEffect(() => {
        if (skipPersistRef.current) {
            skipPersistRef.current = false;
            return;
        }
        try {
            localStorage.setItem(storageKey, collapsed ? '1' : '0');
        } catch {
            /* ignore */
        }
    }, [collapsed, storageKey]);

    const toggle = useCallback(() => setCollapsed((prev) => !prev), []);
    return [collapsed, toggle];
}

interface SectionHeaderProps {
    label: string;
    collapsed: boolean;
    onToggle: () => void;
    testId: string;
}

/**
 * Compact VS Code-style collapsible section header. Kept intentionally short
 * (22px) so it costs almost no vertical space — a rotating chevron plus a small
 * uppercase label that acts as the whole click target.
 */
function SectionHeader({ label, collapsed, onToggle, testId }: SectionHeaderProps) {
    return (
        <button
            type="button"
            onClick={onToggle}
            data-testid={testId}
            aria-expanded={!collapsed}
            title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
            className={cn(
                'group flex h-[22px] w-full flex-shrink-0 items-center gap-1 px-1.5 text-left select-none',
                'text-[10px] font-semibold uppercase tracking-wide leading-none',
                'text-[#6b6b6b] dark:text-[#a0a0a0]',
                'bg-[#f3f3f3] hover:bg-[#e8e8e8] dark:bg-[#252526] dark:hover:bg-[#2d2d2d]',
                'border-b border-[#e5e5e5] dark:border-[#333]',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#007acc]',
                'transition-colors',
            )}
        >
            <span
                aria-hidden="true"
                className={cn(
                    'inline-block text-[8px] leading-none text-[#8a8a8a] transition-transform duration-150',
                    collapsed && '-rotate-90',
                )}
            >
                ▾
            </span>
            <span className="truncate">{label}</span>
        </button>
    );
}

export function SplitWorkspacePanel({
    workspaceId,
    chatList,
    gitList,
    detail,
    chatLabel = 'Chat',
    gitLabel = 'Git',
}: SplitWorkspacePanelProps) {
    const { isMobile } = useBreakpoint();

    // Vertical divider between the chat (top) and git (bottom) halves. The chat
    // half is a top-anchored panel whose height is the persisted "ratio".
    const chatHalf = useResizablePanel({
        direction: 'top',
        initialWidth: CHAT_SPLIT_INITIAL_HEIGHT,
        minWidth: CHAT_SPLIT_MIN_HEIGHT,
        maxWidth: CHAT_SPLIT_MAX_HEIGHT,
        storageKey: splitWorkspaceDividerStorageKey(workspaceId),
    });

    // Horizontal divider setting the whole left column's width.
    const leftColumn = useResizablePanel({
        direction: 'left',
        initialWidth: LEFT_COLUMN_INITIAL_WIDTH,
        minWidth: LEFT_COLUMN_MIN_WIDTH,
        maxWidth: LEFT_COLUMN_MAX_WIDTH,
        storageKey: splitWorkspaceWidthStorageKey(workspaceId),
    });

    const [chatCollapsed, toggleChat] = useCollapsedState(splitWorkspaceChatCollapsedStorageKey(workspaceId));
    const [gitCollapsed, toggleGit] = useCollapsedState(splitWorkspaceGitCollapsedStorageKey(workspaceId));

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

    // Only one half controls the shared resize divider, and only when both are
    // open. If either is collapsed there is nothing to rebalance, so the divider
    // is dropped and the open half simply fills the column.
    const bothExpanded = !chatCollapsed && !gitCollapsed;
    // Chat keeps its persisted fixed height when both are open; when git is
    // collapsed the chat half fills the remaining space instead.
    const chatFills = !chatCollapsed && gitCollapsed;

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
                {/* TOP — chat half: compact header + (resizable) body. */}
                <div
                    className={cn(
                        'flex flex-col min-h-0 overflow-hidden',
                        chatFills ? 'flex-1' : 'flex-shrink-0',
                    )}
                    style={bothExpanded ? { height: chatHalf.width } : undefined}
                    data-testid="split-workspace-chat"
                >
                    <SectionHeader
                        label={chatLabel}
                        collapsed={chatCollapsed}
                        onToggle={toggleChat}
                        testId="split-workspace-chat-header"
                    />
                    <div
                        className={cn('flex-1 min-h-0 overflow-hidden', chatCollapsed && 'hidden')}
                        data-testid="split-workspace-chat-body"
                    >
                        {chatList}
                    </div>
                </div>

                {/* Divider between chat and git — drag up/down to rebalance.
                    Only meaningful (and only shown) when both halves are open. */}
                {bothExpanded && (
                    <div
                        className={cn(
                            DIVIDER_CLASS,
                            'h-2 cursor-row-resize border-y border-[#e0e0e0] dark:border-[#333]',
                            chatHalf.isDragging && 'bg-[#007acc]/20',
                        )}
                        onMouseDown={chatHalf.handleMouseDown}
                        onTouchStart={chatHalf.handleTouchStart}
                        data-testid="split-workspace-divider"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="Resize chat and git panels"
                        aria-valuemin={CHAT_SPLIT_MIN_HEIGHT}
                        aria-valuemax={CHAT_SPLIT_MAX_HEIGHT}
                        aria-valuenow={chatHalf.width}
                        tabIndex={0}
                    >
                        <span className="h-px w-full bg-[#c8c8c8] dark:bg-[#5a5a5a] group-hover:h-[2px] group-hover:bg-[#007acc] transition-all" />
                    </div>
                )}

                {/* BOTTOM — git half: compact header + body. Fills the remaining
                    height whenever it is open. */}
                <div
                    className={cn(
                        'flex flex-col min-h-0 overflow-hidden',
                        gitCollapsed ? 'flex-shrink-0' : 'flex-1',
                    )}
                    data-testid="split-workspace-git"
                >
                    <SectionHeader
                        label={gitLabel}
                        collapsed={gitCollapsed}
                        onToggle={toggleGit}
                        testId="split-workspace-git-header"
                    />
                    <div
                        className={cn('flex-1 min-h-0 overflow-hidden', gitCollapsed && 'hidden')}
                        data-testid="split-workspace-git-body"
                    >
                        {gitList}
                    </div>
                </div>
            </div>

            {/* Divider between the left column and the detail pane. */}
            <div
                className={cn(
                    DIVIDER_CLASS,
                    'w-2 cursor-col-resize border-x border-[#e0e0e0] dark:border-[#333]',
                    leftColumn.isDragging && 'bg-[#007acc]/20',
                )}
                onMouseDown={leftColumn.handleMouseDown}
                onTouchStart={leftColumn.handleTouchStart}
                data-testid="split-workspace-width-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize left panel width"
                aria-valuemin={LEFT_COLUMN_MIN_WIDTH}
                aria-valuemax={LEFT_COLUMN_MAX_WIDTH}
                aria-valuenow={leftColumn.width}
                tabIndex={0}
            >
                <span className="h-full w-px bg-[#c8c8c8] dark:bg-[#5a5a5a] group-hover:w-[2px] group-hover:bg-[#007acc] transition-all" />
            </div>

            {/* RIGHT — the single shared detail pane (last-clicked item). */}
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden" data-testid="split-workspace-detail">
                {detail}
            </div>
        </div>
    );
}
