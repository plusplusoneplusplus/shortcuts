import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn, SegmentedControl } from '../../ui';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import {
    MobileWorkspacePaneProvider,
    useMobileWorkspacePaneState,
    type MobileWorkspacePane,
} from './mobileWorkspacePane';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { usePublishWorkspaceLeftColWidth } from '../../hooks/ui/useWorkspaceLeftColWidth';
import { useHoverPeek } from '../chat/hooks/useHoverPeek';
import {
    LEFT_RAIL_WIDTH,
    splitWorkspaceLeftCollapsedStorageKey,
    useLeftCollapsed,
} from './WorkspaceLeftCollapse';

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
 * At narrow (mobile) widths it drops the dividers and shows ONE pane at a time:
 * a `Chats | Git` segmented control picks the list, and selecting an item pushes
 * the shared detail full-screen over it with a back control. Hidden panes stay
 * mounted (display:none), same keep-alive convention as the desktop branch.
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
     * Stays visible while the section is collapsed. On mobile it is mounted as
     * the single compact toolbar row above the git list, so the git list renders
     * its header in compact (hoisted) form there too.
     */
    gitHeaderExtra?: ReactNode;
    /**
     * Optional docked footer pinned to the bottom of the left column, below the
     * git half. Used by the remote-first shell to host the status/action cluster
     * (connection / notifications / quota / admin / theme). Desktop layout only —
     * the narrow single-column fallback ignores it. When absent, nothing renders.
     */
    footer?: ReactNode;
    /**
     * Start a new chat. Wired to the "+ new chat" button on the collapsed rail so
     * a new conversation can be started without first expanding the column
     * (AC-02). When absent (e.g. isolated unit renders) the rail's new-chat button
     * is omitted. Desktop layout only.
     */
    onNewChat?: () => void;
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
const CHAT_SPLIT_MAX_HEIGHT = 1200;
const CHAT_SPLIT_INITIAL_HEIGHT = 320;
const LEFT_COLUMN_MIN_WIDTH = 240;
const LEFT_COLUMN_MAX_WIDTH = 640;
const LEFT_COLUMN_INITIAL_WIDTH = 360;

/**
 * Label for the chat segment of the mobile switcher. The desktop section header
 * reads "CHAT" (it labels one half of a split); the mobile control is a tab over
 * a list of conversations, so it reads "Chats".
 */
const MOBILE_CHAT_SEGMENT_LABEL = 'Chats';

/** Fraction of the left column height that the Git section occupies by default (~1/3). */
const GIT_DEFAULT_FRACTION = 1 / 3;

function readCollapsed(storageKey: string): boolean {
    try {
        return localStorage.getItem(storageKey) === '1';
    } catch {
        return false;
    }
}

/**
 * True on pointer/desktop devices (mouse/trackpad with hover). Gates the
 * hover-to-float peek of the collapsed rail so touch devices don't float the
 * panel out on an accidental tap. Defaults to true when matchMedia is
 * unavailable (SSR / jsdom). Mirrors the same helper in `RepoChatTab`.
 */
function hasFinePointerDevice(): boolean {
    try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
        return true;
    }
}

/**
 * Persisted collapsed flag for a section, scoped by `storageKey`. Only writes on
 * an explicit user toggle (never on mount or on a workspace switch), so a
 * workspace with no collapse history keeps a clean localStorage. Re-syncs when
 * the key changes (workspace switch).
 *
 * Exported so the workspace right panel (`UnifiedRightPanel`) can reuse the exact
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
    onNewChat,
}: SplitWorkspacePanelProps) {
    const { isMobile } = useBreakpoint();

    const leftColRef = useRef<HTMLDivElement | null>(null);
    // The collapsed-peek overlay and the left column are the SAME (keep-alive)
    // element, so it carries both the measurement ref (clientHeight) and the
    // hover-peek panel ref (outside-click). One callback ref fans out to both.
    const peekPanelRef = useRef<HTMLDivElement | null>(null);
    const setLeftColNode = useCallback((node: HTMLDivElement | null) => {
        leftColRef.current = node;
        peekPanelRef.current = node;
    }, []);

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

    // Mobile-only segment + detail-push state. Always created (hooks cannot be
    // conditional); only provided to the tree on the mobile branch, so every
    // desktop consumer of `useMobileWorkspacePane` still sees `null`.
    const mobilePane = useMobileWorkspacePaneState(workspaceId);

    const [chatCollapsed, toggleChat] = useCollapsedState(splitWorkspaceChatCollapsedStorageKey(workspaceId));
    const [gitCollapsed, toggleGit] = useCollapsedState(splitWorkspaceGitCollapsedStorageKey(workspaceId));

    // Whole-left-column collapse (CHAT + GIT together). Cross-tree store so the
    // sidebar chevron AND the global Cmd/Ctrl+B handler (Router) toggle the same
    // state (AC-01, AC-04). Persisted per-workspace under `:left-collapsed` (AC-05).
    const [leftCollapsed, toggleLeftCollapsed] = useLeftCollapsed(
        splitWorkspaceLeftCollapsedStorageKey(workspaceId),
    );

    // Hover-to-float peek: only on a pointer/desktop device while the column is
    // collapsed. A temporary overlay layer — it never touches the persisted
    // collapsed state (AC-03). The peek panel IS the keep-alive column body.
    const [hasFinePointer] = useState(hasFinePointerDevice);
    const hoverPeek = useHoverPeek({
        enabled: !isMobile && leftCollapsed && hasFinePointer,
        panelRef: peekPanelRef,
    });
    // Drive a one-shot slide-in once the peek opens (matches the ~200ms timing of
    // the classic chat rail's peek).
    const [peekVisible, setPeekVisible] = useState(false);
    useEffect(() => {
        if (!hoverPeek.isOpen) {
            setPeekVisible(false);
            return;
        }
        const raf = requestAnimationFrame(() => setPeekVisible(true));
        return () => cancelAnimationFrame(raf);
    }, [hoverPeek.isOpen]);

    // Apply a proportional default chat height (chat = ~2/3, git = ~1/3) only
    // when the user has no persisted divider value for this workspace. The
    // computed height is never written to localStorage — only a real user drag
    // triggers a persist. Guards on a real measured height so jsdom (height = 0)
    // and degenerate mounts fall back to the 320px constant.
    useLayoutEffect(() => {
        const storageKey = splitWorkspaceDividerStorageKey(workspaceId);
        if (localStorage.getItem(storageKey) !== null) return;
        const colHeight = leftColRef.current?.clientHeight ?? 0;
        if (colHeight > 10) {
            chatHalf.applySize(Math.round(colHeight * (1 - GIT_DEFAULT_FRACTION)));
        }
        // chatHalf.applySize is stable (useCallback with no deps that change);
        // workspaceId is the intentional trigger for a recompute on workspace switch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // Publish the live left-column width so the App shell's global status dock
    // (`GlobalStatusDock`) can match this sidebar's width. While collapsed the
    // column is only the thin rail, so publish the rail width (not the persisted
    // full width) to keep the bottom status bar flush (AC-05). Cleared on mobile /
    // unmount so the dock falls back to its default width where no split sidebar
    // is on screen.
    usePublishWorkspaceLeftColWidth(leftCollapsed ? LEFT_RAIL_WIDTH : leftColumn.width, isMobile);

    // Narrow / mobile: one pane at a time. The segmented control picks the list
    // (chat or git); selecting an item inside it pushes the shared detail
    // full-screen over the list, with a back control that pops it. No pane is
    // ever unmounted — the inactive ones are display:none, so scroll position,
    // in-flight requests and selection survive every switch (AC-01, AC-02).
    if (isMobile) {
        const detailOpen = mobilePane.detailOpen;
        const showChat = !detailOpen && mobilePane.pane === 'chat';
        const showGit = !detailOpen && mobilePane.pane === 'git';
        return (
            <MobileWorkspacePaneProvider value={mobilePane}>
                <div
                    className="split-workspace-panel flex flex-col h-full w-full overflow-hidden"
                    data-testid="split-workspace-panel"
                    data-narrow="true"
                    data-mobile-pane={mobilePane.pane}
                    data-mobile-detail={detailOpen ? 'true' : 'false'}
                >
                    {detailOpen ? (
                        <div
                            className="flex h-11 flex-shrink-0 items-center border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] px-2 dark:bg-[#252526]"
                            data-testid="split-workspace-mobile-detail-bar"
                        >
                            <button
                                type="button"
                                className="touch-target flex items-center gap-1 rounded px-2 text-sm text-[#0078d4] dark:text-[#3794ff]"
                                onClick={() => mobilePane.setDetailOpen(false)}
                                aria-label={`Back to ${mobilePane.pane === 'git' ? gitLabel : MOBILE_CHAT_SEGMENT_LABEL} list`}
                                data-testid="split-workspace-mobile-back"
                            >
                                ← Back
                            </button>
                        </div>
                    ) : (
                        <div
                            className="flex-shrink-0 border-b border-[#e0e0e0] p-1 dark:border-[#3c3c3c]"
                            data-testid="split-workspace-mobile-switcher"
                        >
                            <SegmentedControl<MobileWorkspacePane>
                                size="touch"
                                className="w-full"
                                value={mobilePane.pane}
                                onChange={mobilePane.setPane}
                                options={[
                                    { value: 'chat', label: MOBILE_CHAT_SEGMENT_LABEL, testId: 'split-workspace-mobile-pane-chat' },
                                    { value: 'git', label: gitLabel, testId: 'split-workspace-mobile-pane-git' },
                                ]}
                                aria-label="Workspace pane"
                            />
                        </div>
                    )}
                    <div
                        className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', !showChat && 'hidden')}
                        data-testid="split-workspace-chat"
                    >
                        {chatList}
                    </div>
                    <div
                        className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', !showGit && 'hidden')}
                        data-testid="split-workspace-git"
                    >
                        {/* Mounting the header portal target here is what makes
                            `headerToolbarContainer` non-null, so `RepoGitTab`
                            hoists its toolbar and renders the COMPACT header
                            instead of the full inline branch/Pull/sync block
                            (AC-04). One toolbar row, not two. */}
                        {gitHeaderExtra && (
                            <div
                                className="flex min-h-[44px] flex-shrink-0 items-center border-b border-[#e0e0e0] px-2 dark:border-[#3c3c3c]"
                                data-testid="split-workspace-git-header-extra"
                            >
                                {gitHeaderExtra}
                            </div>
                        )}
                        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">{gitList}</div>
                    </div>
                    <div
                        className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', !detailOpen && 'hidden')}
                        data-testid="split-workspace-detail"
                    >
                        {detail}
                    </div>
                </div>
            </MobileWorkspacePaneProvider>
        );
    }

    // Only one half controls the shared resize divider, and only when both are
    // open. If either is collapsed there is nothing to rebalance, so the divider
    // is dropped and the open half simply fills the column.
    const bothExpanded = !chatCollapsed && !gitCollapsed;
    // Chat keeps its persisted fixed height when both are open; when git is
    // collapsed the chat half fills the remaining space instead.
    const chatFills = !chatCollapsed && gitCollapsed;
    // When both halves are collapsed neither one carries `flex-1`, so nothing
    // fills the column and the docked footer would ride up under the git header
    // instead of staying pinned to the bottom-left. A spacer absorbs the slack.
    const bothCollapsed = chatCollapsed && gitCollapsed;

    // While collapsed the column body floats out as an absolute overlay only
    // during a hover-peek; otherwise it is hidden (display:none) but stays mounted
    // so chat/git scroll + per-section collapse survive a collapse round-trip
    // (keep-alive, mirroring the right dock).
    const peeking = leftCollapsed && hoverPeek.isOpen;

    return (
        <div
            className="split-workspace-panel relative flex h-full w-full overflow-hidden"
            data-testid="split-workspace-panel"
        >
            {/* COLLAPSED RAIL — a thin strip that replaces the column when
                collapsed. Hovering it floats the full CHAT+GIT panel back as a
                temporary peek (AC-02 / AC-03). */}
            {leftCollapsed && (
                <div
                    // `relative z-40` keeps the rail painted ABOVE the peek overlay
                    // (`z-30`): while hovering floats the column out, the `»` pin
                    // button stays uncovered and clickable at a fixed spot instead
                    // of being hidden behind the auto-expanded panel.
                    className="relative z-40 w-9 flex-shrink-0 border-r border-[#e5e5e5] dark:border-[#333] flex flex-col items-center pt-2 gap-1"
                    data-testid="split-workspace-left-rail"
                    onMouseEnter={hoverPeek.onRailPointerEnter}
                    onMouseLeave={hoverPeek.onRailPointerLeave}
                >
                    <button
                        type="button"
                        className={`w-7 h-7 flex items-center justify-center rounded text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]${peeking ? ' bg-[#e8e8e8] text-[#333] ring-1 ring-[#007acc]/40 dark:bg-[#2d2d2d] dark:text-[#ddd]' : ''}`}
                        onClick={toggleLeftCollapsed}
                        aria-label={peeking ? 'Keep sidebar open' : 'Expand sidebar'}
                        title={peeking ? 'Keep sidebar open' : 'Expand sidebar'}
                        data-testid="split-workspace-left-expand"
                    >
                        »
                    </button>
                    {onNewChat && (
                        <button
                            type="button"
                            className="w-7 h-7 flex items-center justify-center rounded text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]"
                            onClick={onNewChat}
                            aria-label="Start a new conversation"
                            title="Start a new conversation"
                            data-testid="split-workspace-left-new-chat"
                        >
                            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                                <path d="M7 2v10M2 7h10" />
                            </svg>
                        </button>
                    )}
                    <span
                        className="mt-1 text-[10px] tracking-wide text-[#848484] select-none"
                        style={{ writingMode: 'vertical-rl' }}
                    >
                        Workspace
                    </span>
                </div>
            )}

            {/* LEFT COLUMN — chat list (top) + git list (bottom). In-flow at its
                persisted width when expanded; when collapsed it stays mounted but
                hidden, floating back as an absolute overlay only while peeking. */}
            <div
                ref={setLeftColNode}
                className={cn(
                    'flex flex-col min-h-0 overflow-hidden border-r border-[#e5e5e5] dark:border-[#333]',
                    !leftCollapsed && 'flex-shrink-0',
                    leftCollapsed && !peeking && 'hidden',
                    peeking &&
                        'absolute inset-y-0 left-0 z-30 bg-[#fafafa] dark:bg-[#1e1e1e] shadow-xl transition-transform duration-200 ease-out ' +
                            (peekVisible ? 'translate-x-0' : '-translate-x-full'),
                )}
                style={{ width: leftColumn.width }}
                data-testid="split-workspace-left"
                onMouseEnter={leftCollapsed ? hoverPeek.onPanelPointerEnter : undefined}
                onMouseLeave={leftCollapsed ? hoverPeek.onPanelPointerLeave : undefined}
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

                {/* Both halves collapsed: no half carries flex-1, so this
                    spacer grows to fill the column and keeps the footer pinned
                    to the bottom-left instead of riding up under the headers. */}
                {bothCollapsed && (
                    <div
                        className="flex-1 min-h-0"
                        aria-hidden="true"
                        data-testid="split-workspace-spacer"
                    />
                )}

                {/* Docked footer pinned to the bottom of the left column (below
                    the git half). Hosts the remote-first shell's status cluster. */}
                {footer && (
                    <div className="flex-shrink-0" data-testid="split-workspace-footer">
                        {footer}
                    </div>
                )}
            </div>

            {/* Divider between the left column and the detail pane, plus the
                whole-column collapse chevron on the column's inner edge. Dropped
                while collapsed — the rail owns the expand affordance then. */}
            {!leftCollapsed && (
                <div className="relative flex items-stretch flex-shrink-0 group">
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
                    {/* `«` collapse chevron — hover-revealed on the inner edge,
                        mirroring the classic chat rail's collapse affordance. */}
                    <button
                        type="button"
                        className="absolute top-1 -left-6 w-6 h-6 flex items-center justify-center rounded text-[#848484] bg-[#fafafa] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] opacity-0 group-hover:opacity-100 hover:text-[#333] dark:hover:text-[#ddd] transition-opacity z-10"
                        onClick={toggleLeftCollapsed}
                        aria-label="Collapse sidebar"
                        title="Collapse sidebar"
                        data-testid="split-workspace-left-collapse"
                    >
                        «
                    </button>
                </div>
            )}

            {/* RIGHT — the single shared detail pane (last-clicked item). */}
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden" data-testid="split-workspace-detail">
                {detail}
            </div>
        </div>
    );
}
