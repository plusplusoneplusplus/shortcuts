import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReferencesDropdown, ReferenceList, deduplicateReferenceFiles } from '../../ui/ReferencesDropdown';
import { BottomSheet } from '../../ui/BottomSheet';
import { ConversationMetadataPopover, type MetaRow } from './conversation/ConversationMetadataPopover';
import { ContextWindowIndicator } from '../../ui/ContextWindowIndicator';
import { copyToClipboard, copyHtmlToClipboard, formatConversationAsText, formatConversationAsHtml, formatDuration } from '../../utils/format';
import { ChatStatusPill } from './ChatStatusPill';
import { chatMarkdownToHtml } from './conversation/ConversationTurnBubble';
import { snapshotConversation, openPrintPreview } from '../../utils/snapshot-copy-utils';
import { cn } from '../../ui/cn';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useContainerWidth, type ContainerWidthTier } from './hooks/useContainerWidth';
import { useFloatingChats } from '../../contexts/FloatingChatsContext';
import { ChatHeaderOverflowMenu, type OverflowMenuItem } from './ChatHeaderOverflowMenu';
import type { ClientConversationTurn } from '../../types/dashboard';
import { LoopBadge } from './LoopBadge';
import { ProviderBadge, getTaskProviderBadgeProvider } from './ProviderBadge';
import { isLoopsEnabled } from '../../utils/config';

/**
 * Shared icon-button class for the right-side chat header actions.
 *
 * Visual contract (matches the conversation-redesign-3 mockup `.icon-btn` token):
 *   - Fixed 26×26 hit target for comfortable touch on mobile + visual consistency
 *   - Rounded 4px corners, muted resting color, surface-2 hover bg + fg-strong text
 *   - Disabled state preserves the existing 40% opacity contract used across the SPA
 */
const ICON_BTN_CLASS =
    'inline-flex items-center justify-center w-[26px] h-[26px] rounded text-[#848484] '
    + 'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] '
    + 'hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] '
    + 'disabled:opacity-40 disabled:cursor-not-allowed '
    + 'transition-colors flex-shrink-0';

/**
 * Companion class for inline text-label action chips (HTML / PDF / Select).
 * Matches `ICON_BTN_CLASS` vertical metrics (h-[26px]) for a level row, but allows
 * the button width to flex with its text content.
 */
const TEXT_BTN_CLASS =
    'inline-flex items-center justify-center h-[26px] px-1.5 rounded text-[10px] '
    + 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] '
    + 'hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] '
    + 'disabled:opacity-40 disabled:cursor-not-allowed '
    + 'transition-colors flex-shrink-0';

export interface ChatHeaderProps {
    task: any;
    metadataProcess: any;
    planPath: string;
    createdFiles: { filePath: string }[];
    pinnedFile: { filePath: string } | undefined;
    onBack?: () => void;
    variant: 'inline' | 'floating';
    isPopOut: boolean;
    loading: boolean;
    turns: ClientConversationTurn[];
    resumeLaunching: boolean;
    resumeSessionId: string | null | undefined;
    isPending: boolean;
    sessionTokenLimit: number | undefined;
    sessionCurrentTokens: number | undefined;
    sessionModel: string | undefined;
    /** System-prompt token count (Copilot SDK only) */
    sessionSystemTokens?: number;
    /** Tool-definition token count (Copilot SDK only) */
    sessionToolTokens?: number;
    /** Conversation-history token count (Copilot SDK only) */
    sessionConversationTokens?: number;
    copied: boolean;
    setCopied: (v: boolean) => void;
    taskId: string;
    onLaunchInteractiveResume: () => void;
    /** Copies the bare provider-specific resume command to the clipboard. Shown beside "Resume In CLI". */
    onCopyResumeCommand?: () => void;
    onPopOut: () => void;
    onFloat: () => void;
    /** Override the default "Chat" title */
    title?: string;
    /** Workspace ID for HTML copy (markdown rendering with image path rewriting) */
    wsId?: string;
    /** Ref to the turns container DOM element for DOM snapshot copy */
    turnsContainerRef?: React.RefObject<HTMLDivElement | null>;
    /** Whether turn selection mode is active */
    isSelecting?: boolean;
    /** Toggle selection mode on/off */
    onToggleSelecting?: () => void;
    /** Whether to show the "Open Scratchpad" button */
    showScratchpadButton?: boolean;
    /** Called when the user clicks the "Open Scratchpad" button */
    onOpenScratchpad?: () => void;
    /** Called when the user clicks the Fork button */
    onFork?: () => void;
    /** Whether a fork operation is in progress */
    forking?: boolean;
    /** Number of non-cancelled loops for this conversation */
    loopCount?: number;
    /** Whether any non-cancelled loops are actively running */
    hasActiveLoops?: boolean;
    /** Called when the user clicks the loop badge */
    onToggleLoopPanel?: () => void;
    /** Called when the user double-clicks the title to rename. Header always shows the user-set name. */
    onRenameTitle?: () => void;
    /** Called by lens chat embeddings to archive the current binding and show an empty same-target composer. */
    onStartFreshSameContext?: () => Promise<boolean> | boolean | void;
    /** True while the lens chat fresh-context operation is in progress. */
    startingFreshSameContext?: boolean;
    /** Optional control rendered at the start of the right-side action area (e.g. the Thread/Agents view toggle). */
    viewToggle?: ReactNode;
    /**
     * Extra metadata rows forwarded to the conversation-metadata popover, shown
     * after its standard rows. Used by read-only surfaces (e.g. native CLI
     * sessions) to surface fields with no built-in slot — repository, branch,
     * cwd, host, created/updated, stored summary. Omitted for CoC chats.
     */
    metadataExtraRows?: MetaRow[];
}

/** Build overflow menu items based on what's hidden at the current container tier */
function buildOverflowItems(
    tier: ContainerWidthTier,
    props: {
        task: any;
        loading: boolean;
        turns: ClientConversationTurn[];
        isPending: boolean;
        resumeSessionId: string | null | undefined;
        resumeLaunching: boolean;
        onLaunchInteractiveResume: () => void;
        onCopyResumeCommand?: () => void;
        metadataProcess: any;
        planPath: string;
        createdFiles: { filePath: string }[];
        wsId?: string;
        sessionTokenLimit: number | undefined;
        sessionCurrentTokens: number | undefined;
        sessionModel: string | undefined;
        sessionSystemTokens?: number;
        sessionToolTokens?: number;
        sessionConversationTokens?: number;
        variant: 'inline' | 'floating';
        isPopOut: boolean;
        isMobile: boolean;
        isFloatingChat: boolean;
        taskId: string;
        onFloat: () => void;
        onPopOut: () => void;
        onCopyHtml: () => void;
        copiedHtml: boolean;
        onExportPdf: () => void;
        onOpenRefs?: () => void;
        onToggleSelecting?: () => void;
        isSelecting?: boolean;
        showScratchpadButton?: boolean;
        onOpenScratchpad?: () => void;
        onFork?: () => void;
        forking?: boolean;
        onStartFreshSameContext?: () => Promise<boolean> | boolean | void;
        startingFreshSameContext?: boolean;
        metadataExtraRows?: MetaRow[];
    },
): OverflowMenuItem[] {
    if (tier === 'wide') return [];

    const items: OverflowMenuItem[] = [];

    // Copy HTML — always in overflow at < 700px
    items.push({
        key: 'copy-html',
        label: props.copiedHtml ? '✓ Copied HTML' : 'Copy as HTML',
        icon: <span className="text-[10px]">HTML</span>,
        onClick: props.onCopyHtml,
    });

    // Select turns for partial copy
    if (props.onToggleSelecting && props.turns.length > 0) {
        items.push({
            key: 'select-turns',
            label: props.isSelecting ? 'Cancel selection' : 'Select turns',
            icon: <span className="text-[10px]">☐</span>,
            onClick: props.onToggleSelecting,
        });
    }

    // Export as PDF
    items.push({
        key: 'export-pdf',
        label: 'Export as PDF',
        icon: <span className="text-[10px]">PDF</span>,
        onClick: props.onExportPdf,
    });

    // Metadata
    if (!props.isPending && props.metadataProcess) {
        items.push({
            key: 'metadata',
            label: 'Metadata',
            icon: <span className="text-[10px] font-semibold">i</span>,
            onClick: () => { /* handled via render */ },
            render: () => (
                <ConversationMetadataPopover process={props.metadataProcess} turnsCount={props.turns.length} extraRows={props.metadataExtraRows} />
            ),
        });
    }

    // References
    const dedupedFiles = deduplicateReferenceFiles(props.planPath, props.createdFiles);
    const refTotal = (props.planPath ? 1 : 0) + dedupedFiles.length;
    if (refTotal > 0) {
        if (props.isMobile && props.onOpenRefs) {
            // On mobile, open a standalone BottomSheet outside the overflow menu
            items.push({
                key: 'references',
                label: `References (${refTotal})`,
                onClick: props.onOpenRefs,
            });
        } else {
            items.push({
                key: 'references',
                label: `References (${refTotal})`,
                onClick: () => { /* handled via render */ },
                render: () => (
                    <ReferencesDropdown planPath={props.planPath} files={props.createdFiles} wsId={props.wsId} />
                ),
            });
        }
    }

    // Resume In CLI
    if (!props.isPending && props.resumeSessionId && !props.isMobile) {
        items.push({
            key: 'resume-cli',
            label: 'Resume In CLI',
            icon: <span className="text-xs">▶</span>,
            onClick: props.onLaunchInteractiveResume,
        });
        // Copy Command — bare, paste-ready resume invocation. Shown alongside
        // Resume In CLI for both local and remote workspaces.
        if (props.onCopyResumeCommand) {
            items.push({
                key: 'copy-resume-cli',
                label: 'Copy Command',
                icon: <span className="text-xs">⧉</span>,
                onClick: props.onCopyResumeCommand,
            });
        }
    }

    // Duration
    if (props.task?.duration != null) {
        items.push({
            key: 'duration',
            label: `Duration: ${formatDuration(props.task.duration)}`,
            icon: <span className="text-xs">⏱</span>,
            onClick: () => {},
        });
    }

    // Context window
    if (props.sessionTokenLimit && props.sessionTokenLimit > 0) {
        items.push({
            key: 'context-window',
            label: 'Context window',
            onClick: () => {},
            render: () => (
                <ContextWindowIndicator
                    tokenLimit={props.sessionTokenLimit}
                    currentTokens={props.sessionCurrentTokens}
                    modelName={props.sessionModel}
                    className="flex max-w-[240px]"
                    systemTokens={props.sessionSystemTokens}
                    toolDefinitionsTokens={props.sessionToolTokens}
                    conversationTokens={props.sessionConversationTokens}
                />
            ),
        });
    }

    // Open Scratchpad — in overflow at non-wide tiers
    if (props.showScratchpadButton && props.onOpenScratchpad) {
        items.push({
            key: 'open-scratchpad',
            label: 'Open scratchpad',
            icon: <span className="text-[10px]">📄</span>,
            onClick: props.onOpenScratchpad,
        });
    }

    if (props.onStartFreshSameContext) {
        items.push({
            key: 'new-chat-same-context',
            label: 'New chat with same context',
            icon: <span className="text-[10px]">＋</span>,
            onClick: props.startingFreshSameContext
                ? () => {}
                : () => { void props.onStartFreshSameContext?.(); },
        });
    }

    // Fork — in overflow at non-wide tiers
    if (props.onFork) {
        items.push({
            key: 'fork',
            label: props.forking ? 'Forking…' : 'Fork conversation',
            icon: <span className="text-[10px]">🍴</span>,
            onClick: props.forking ? () => {} : props.onFork,
        });
    }

    // Float / Pop-out — only in overflow at narrow (< 500px)
    if (tier === 'narrow') {
        if (props.variant !== 'floating' && !props.isPopOut && !props.isMobile && !props.isFloatingChat) {
            items.push({
                key: 'float',
                label: 'Float in window',
                onClick: props.onFloat,
            });
        }
        if (!props.isPopOut && !props.isMobile && props.variant !== 'floating') {
            items.push({
                key: 'popout',
                label: 'Pop out to new window',
                onClick: props.onPopOut,
            });
        }
    }

    return items;
}

export function ChatHeader({
    task,
    metadataProcess,
    planPath,
    createdFiles,
    pinnedFile,
    onBack,
    variant,
    isPopOut,
    loading,
    turns,
    resumeLaunching,
    resumeSessionId,
    isPending,
    sessionTokenLimit,
    sessionCurrentTokens,
    sessionModel,
    sessionSystemTokens,
    sessionToolTokens,
    sessionConversationTokens,
    copied,
    setCopied,
    taskId,
    onLaunchInteractiveResume,
    onCopyResumeCommand,
    onPopOut,
    onFloat,
    title,
    wsId,
    turnsContainerRef,
    isSelecting,
    onToggleSelecting,
    showScratchpadButton,
    onOpenScratchpad,
    onFork,
    forking,
    loopCount,
    hasActiveLoops = false,
    onToggleLoopPanel,
    onRenameTitle,
    onStartFreshSameContext,
    startingFreshSameContext = false,
    viewToggle,
    metadataExtraRows,
}: ChatHeaderProps) {
    const { isMobile } = useBreakpoint();
    const { isFloating } = useFloatingChats();
    const [copiedHtml, setCopiedHtml] = useState(false);
    const [refsSheetOpen, setRefsSheetOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { tier } = useContainerWidth(containerRef);

    // Close the standalone refs BottomSheet when a file link opens the markdown review dialog
    useEffect(() => {
        if (!refsSheetOpen) return;
        const handler = () => setRefsSheetOpen(false);
        window.addEventListener('coc-open-markdown-review', handler);
        return () => window.removeEventListener('coc-open-markdown-review', handler);
    }, [refsSheetOpen]);

    const handleCopyHtml = async () => {
        try {
            let html: string;
            if (turnsContainerRef?.current) {
                html = snapshotConversation(turnsContainerRef.current);
            } else {
                html = formatConversationAsHtml(turns, (c) => chatMarkdownToHtml(c, wsId));
            }
            await copyHtmlToClipboard(html);
            setCopiedHtml(true);
            setTimeout(() => setCopiedHtml(false), 2000);
        } catch (e) {
            console.error('Copy HTML failed:', e);
        }
    };

    const handleExportPdf = () => {
        try {
            let html: string;
            if (turnsContainerRef?.current) {
                html = snapshotConversation(turnsContainerRef.current, { forPrint: true });
            } else {
                html = formatConversationAsHtml(turns, (c) => chatMarkdownToHtml(c, wsId));
            }
            const chatTitle = title ?? turns[0]?.content?.slice(0, 60) ?? 'Chat';
            openPrintPreview(html, chatTitle);
        } catch (e: any) {
            console.error('Export PDF failed:', e);
        }
    };

    const isWide = tier === 'wide';
    const isNarrow = tier === 'narrow';
    const showFloatPopout = isWide || (!isNarrow);
    const providerBadgeProvider = getTaskProviderBadgeProvider(task);

    const overflowItems = useMemo(() => buildOverflowItems(tier, {
        task,
        loading,
        turns,
        isPending,
        resumeSessionId,
        resumeLaunching,
        onLaunchInteractiveResume,
        onCopyResumeCommand,
        metadataProcess,
        planPath,
        createdFiles,
        wsId,
        sessionTokenLimit,
        sessionCurrentTokens,
        sessionModel,
        sessionSystemTokens,
        sessionToolTokens,
        sessionConversationTokens,
        variant,
        isPopOut,
        isMobile,
        isFloatingChat: isFloating(taskId),
        taskId,
        onFloat,
        onPopOut,
        onCopyHtml: () => void handleCopyHtml(),
        copiedHtml,
        onExportPdf: handleExportPdf,
        onOpenRefs: () => setRefsSheetOpen(true),
        onToggleSelecting,
        isSelecting,
        showScratchpadButton,
        onOpenScratchpad,
        onFork,
        forking,
        onStartFreshSameContext,
        startingFreshSameContext,
        metadataExtraRows,
    }), [tier, task, loading, turns, isPending, resumeSessionId, resumeLaunching, metadataProcess, planPath, createdFiles, sessionTokenLimit, sessionCurrentTokens, sessionModel, sessionSystemTokens, sessionToolTokens, sessionConversationTokens, variant, isPopOut, isMobile, taskId, copiedHtml, onFloat, onPopOut, onLaunchInteractiveResume, onCopyResumeCommand, isFloating, wsId, onToggleSelecting, isSelecting, showScratchpadButton, onOpenScratchpad, onFork, forking, onStartFreshSameContext, startingFreshSameContext, metadataExtraRows]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div
            ref={containerRef}
            data-testid="chat-header"
            className={cn(
                'flex items-center justify-between',
                variant === 'floating'
                    ? 'px-2 py-1'
                    : 'px-4 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]',
            )}
        >
            {/* Left side */}
            <div className="flex items-center gap-2 min-w-0">
                {onBack && variant !== 'floating' && (
                    <button
                        className="inline-flex items-center justify-center px-2 text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff] mr-1 flex-shrink-0"
                        onClick={onBack}
                        data-testid="activity-chat-back-btn"
                    >
                        ← Back
                    </button>
                )}
                <span
                    className={cn(
                        'text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]',
                        isNarrow && 'truncate max-w-[120px]',
                        onRenameTitle && 'cursor-text select-none',
                    )}
                    title={onRenameTitle ? 'Double-click to rename' : undefined}
                    onDoubleClick={onRenameTitle ? (e) => { e.stopPropagation(); onRenameTitle(); } : undefined}
                >
                    {title ?? 'Chat'}
                </span>
                {task && (
                    <ChatStatusPill
                        data-testid="badge"
                        status={task.status}
                        type={task.type}
                        durationMs={task.duration ?? undefined}
                        showDuration={isWide}
                        iconOnly={!isWide}
                    />
                )}
                {isLoopsEnabled() && (loopCount ?? 0) > 0 && (
                    <LoopBadge count={loopCount!} hasActiveLoops={hasActiveLoops} onClick={onToggleLoopPanel} />
                )}
                {providerBadgeProvider && (
                    <ProviderBadge provider={providerBadgeProvider} />
                )}
                {/* References — only in wide tier (live ctx + duration moved into pill / composer) */}
                {isWide && (
                    <ReferencesDropdown planPath={planPath} files={createdFiles} wsId={wsId} />
                )}
            </div>

            {/* Right side */}
            <div className="flex items-center flex-shrink-0">
                {/* View toggle (Thread / Agents), when provided by the host. */}
                {viewToggle}
                {/*
                  Vertical divider visually separates the identity/status area
                  from the action group, matching the redesign mockup's
                  `.chat-header .divider`. Hidden in floating variant where
                  the chrome is intentionally minimal.
                */}
                {variant !== 'floating' && (
                    <span
                        aria-hidden="true"
                        className="hidden sm:inline-block w-px self-stretch my-1 mx-1 bg-[#e0e0e0] dark:bg-[#3c3c3c] flex-shrink-0"
                    />
                )}
                {/*
                  Action group. `gap-0.5` ties the icon buttons together
                  visually as a single cluster (matches `.chat-header .actions`
                  `gap:2px` in the mockup). `flex-wrap` lets the cluster wrap
                  to a second line on extremely narrow mobile widths instead
                  of horizontally overflowing.
                */}
                <div className="inline-flex items-center gap-0.5 flex-wrap justify-end flex-shrink-0">
                {/* Open Scratchpad — inline in wide tier, overflow in narrower tiers */}
                {isWide && showScratchpadButton && onOpenScratchpad && (
                    <button
                        title="Open scratchpad"
                        data-testid="open-scratchpad-btn"
                        onClick={onOpenScratchpad}
                        className={ICON_BTN_CLASS}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                            <line x1="3" y1="4" x2="13" y2="4" />
                            <line x1="3" y1="8" x2="13" y2="8" />
                            <line x1="3" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                )}
                {/* Float / Popout buttons — shown in wide + medium, hidden in narrow (moved to overflow) */}
                {showFloatPopout && variant !== 'floating' && !isPopOut && !isMobile && !isFloating(taskId) && (
                    <button
                        title="Float in current window"
                        data-testid="activity-chat-float-btn"
                        onClick={onFloat}
                        className={ICON_BTN_CLASS}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                            <path d="M2 6h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                    </button>
                )}
                {showFloatPopout && !isPopOut && !isMobile && variant !== 'floating' && (
                    <button
                        title="Pop out to new window"
                        data-testid="activity-chat-popout-btn"
                        onClick={onPopOut}
                        className={ICON_BTN_CLASS}
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M10 2h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M14 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                    </button>
                )}
                {/* Copy conversation — always visible */}
                <button
                    title="Copy conversation"
                    data-testid="copy-conversation-btn"
                    disabled={loading || turns.length === 0}
                    onClick={() => {
                        void copyToClipboard(formatConversationAsText(turns)).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        });
                    }}
                    className={ICON_BTN_CLASS}
                >
                    {copied ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M2 8L6 12L14 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="4" y="4" width="9" height="11" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                            <path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.5"/>
                            <path d="M3 2h7a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5"/>
                        </svg>
                    )}
                </button>
                {/* Copy HTML + PDF + Metadata — inline only in wide tier */}
                {isWide && (
                    <>
                        <button
                            title="Copy conversation as HTML"
                            data-testid="copy-conversation-html-btn"
                            disabled={loading || turns.length === 0}
                            onClick={() => void handleCopyHtml()}
                            className={TEXT_BTN_CLASS}
                        >
                            {copiedHtml ? '✓' : 'HTML'}
                        </button>
                        <button
                            title="Export conversation as PDF"
                            data-testid="export-conversation-pdf-btn"
                            disabled={loading || turns.length === 0}
                            onClick={handleExportPdf}
                            className={TEXT_BTN_CLASS}
                        >
                            PDF
                        </button>
                        {onToggleSelecting && turns.length > 0 && (
                            <button
                                title={isSelecting ? 'Cancel selection' : 'Select turns for partial copy'}
                                data-testid="select-turns-btn"
                                onClick={onToggleSelecting}
                                className={cn(
                                    'inline-flex items-center justify-center h-[26px] px-1.5 rounded text-[10px] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0',
                                    isSelecting
                                        ? 'text-[#0078d4] dark:text-[#3794ff] font-medium'
                                        : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                )}
                            >
                                {isSelecting ? '✕ Cancel' : '☐ Select'}
                            </button>
                        )}
                        {!isPending && metadataProcess && (
                            <ConversationMetadataPopover
                                process={metadataProcess}
                                turnsCount={turns.length}
                                extraRows={metadataExtraRows}
                                resumeSessionId={isMobile ? undefined : resumeSessionId}
                                resumeLaunching={resumeLaunching}
                                onLaunchInteractiveResume={isMobile ? undefined : onLaunchInteractiveResume}
                                onCopyResumeCommand={isMobile ? undefined : onCopyResumeCommand}
                                onFork={onFork}
                                forking={forking}
                                onStartFreshSameContext={onStartFreshSameContext}
                                startingFreshSameContext={startingFreshSameContext}
                            />
                        )}
                    </>
                )}
                {/* Overflow menu — shown at < 700px */}
                {!isWide && <ChatHeaderOverflowMenu items={overflowItems} wsId={wsId} />}
                </div>
            </div>

            {/* Standalone References BottomSheet for mobile — rendered outside the overflow menu */}
            {isMobile && (
                <BottomSheet
                    isOpen={refsSheetOpen}
                    onClose={() => setRefsSheetOpen(false)}
                    title={`References (${(planPath ? 1 : 0) + deduplicateReferenceFiles(planPath, createdFiles).length})`}
                >
                    <div className="flex flex-col gap-1 p-2" {...(wsId ? { 'data-ws-id': wsId } : {})}>
                        <ReferenceList planPath={planPath} files={createdFiles} />
                    </div>
                </BottomSheet>
            )}
        </div>
    );
}
