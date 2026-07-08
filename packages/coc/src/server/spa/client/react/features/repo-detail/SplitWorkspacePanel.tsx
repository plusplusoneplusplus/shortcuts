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
    /**
     * Optional content rendered inside the git section header, right of the
     * chevron+label toggle. Used to hoist the git toolbar (branch pill / sync /
     * refresh) onto the 22px header row so it costs no extra vertical space.
     * Stays visible while the section is collapsed. Desktop layout only — the
     * narrow single-column fallback ignores it.
     */
    gitHeaderExtra?: ReactNode;
    /**
     * Optional docked footer pinned to the bottom of the left column, below the
     * git half. Used by the remote-first shell to host the status/action cluster
     * (connection / notifications / quota / admin / theme). Desktop layout only —
     * the narrow single-column fallback ignores it. When absent, nothing renders.
     */
    footer?: ReactNode;
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
 *
 * Exported so the workspace right dock (`WorkspaceRightDock`) can reuse the exact
 * same persisted-boolean semantics for its open/closed flag (AC-06).
 */
export function useCollapsedState(storageKey: string): [boolean, () => void] {
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
    /** Extra content (e.g. a hoisted toolbar) rendered right of the toggle. */
    extra?: ReactNode;
}

/**
 * Compact VS Code-style collapsible section header. Kept intentionally short
 * (22px) so it costs almost no vertical space — a rotating chevron plus a small
 * uppercase label that acts as the click target. When `extra` is given the
 * label shrinks to its natural width and the extra content fills the rest of
 * the row (its clicks do not toggle the section).
 */
function SectionHeader({ label, collapsed, onToggle, testId, extra }: SectionHeaderProps) {
    return (
        <div
            className={cn(
                'flex h-[22px] w-full flex-shrink-0 items-stretch',
                // A cool blue-grey band so the header reads as a distinct
                // divider against the white chat/git content below it.
                'bg-[#e4e9f2] dark:bg-[#2c303a]',
                'border-b border-[#cfd6e4] dark:border-[#3b414d]',
            )}
        >
            <button
                type="button"
                onClick={onToggle}
                data-testid={testId}
                aria-expanded={!collapsed}
                title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
                className={cn(
                    'group flex items-center gap-1 px-1.5 text-left select-none',
                    extra ? 'flex-shrink-0' : 'w-full flex-1',
                    'text-[10px] font-semibold uppercase tracking-wide leading-none',
                    'text-[#4d566b] dark:text-[#b6bcc9]',
                    'hover:bg-[#d7deec] dark:hover:bg-[#353a46]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#007acc]',
                    'transition-colors',
                )}
            >
                <span
                    aria-hidden="true"
                    className={cn(
                        'inline-block text-[8px] leading-none text-[#7883a0] transition-transform duration-150',
                        collapsed && '-rotate-90',
                    )}
                >
                    ▾
                </span>
                <span className="truncate">{label}</span>
            </button>
            {extra && (
                <div
                    className="flex min-w-0 flex-1 items-center justify-end pr-0.5"
                    data-testid={`${testId}-extra`}
                >
                    {extra}
                </div>
            )}
        </div>
    );
}

export function SplitWorkspacePanel({
    workspaceId,
    chatList,
    gitList,
    detail,
    chatLabel = 'Chat',
    gitLabel = 'Git',
    gitHeaderExtra,
    footer,
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

    // Publish the live left-column width so the App shell's global status dock
    // (`GlobalStatusDock`) can match this sidebar's width. Cleared on unmount /
    // mobile so the dock falls back to its default width where no split sidebar
    // is on screen.
    useEffect(() => {
        if (isMobile) {
            document.documentElement.style.removeProperty('--workspace-left-col-width');
            return;
        }
        document.documentElement.style.setProperty('--workspace-left-col-width', `${leftColumn.width}px`);
        return () => {
            document.documentElement.style.removeProperty('--workspace-left-col-width');
        };
    }, [isMobile, leftColumn.width]);

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
                        'flex flex-col min-h-0',
                        // overflow-visible while collapsed so the hoisted
                        // toolbar's dropdown isn't clipped to the 22px header.
                        gitCollapsed ? 'flex-shrink-0 overflow-visible' : 'flex-1 overflow-hidden',
                    )}
                    data-testid="split-workspace-git"
                >
                    <SectionHeader
                        label={gitLabel}
                        collapsed={gitCollapsed}
                        onToggle={toggleGit}
                        testId="split-workspace-git-header"
                        extra={gitHeaderExtra}
                    />
                    <div
                        className={cn('flex-1 min-h-0 overflow-hidden', gitCollapsed && 'hidden')}
                        data-testid="split-workspace-git-body"
                    >
                        {gitList}
                    </div>
                </div>

                {/* Docked footer pinned to the bottom of the left column (below
                    the git half). Hosts the remote-first shell's status cluster. */}
                {footer && (
                    <div className="flex-shrink-0" data-testid="split-workspace-footer">
                        {footer}
                    </div>
                )}
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
