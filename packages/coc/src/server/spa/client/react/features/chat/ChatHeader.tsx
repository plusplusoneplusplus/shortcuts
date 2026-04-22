import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../shared';
import { Button } from '../../shared';
import { ReferencesDropdown, ReferenceList, deduplicateReferenceFiles } from '../../shared/ReferencesDropdown';
import { BottomSheet } from '../../shared/BottomSheet';
import { ConversationMetadataPopover } from './conversation/ConversationMetadataPopover';
import { ContextWindowIndicator } from '../../shared/ContextWindowIndicator';
import { copyToClipboard, copyHtmlToClipboard, formatConversationAsText, formatConversationAsHtml, formatDuration, statusIcon, statusLabel } from '../../utils/format';
import { chatMarkdownToHtml } from './conversation/ConversationTurnBubble';
import { snapshotConversation } from '../../utils/snapshot-copy-utils';
import { cn } from '../../shared/cn';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useContainerWidth, type ContainerWidthTier } from './hooks/useContainerWidth';
import { useFloatingChats } from '../../contexts/FloatingChatsContext';
import { ChatHeaderOverflowMenu, type OverflowMenuItem } from './ChatHeaderOverflowMenu';
import type { ClientConversationTurn } from '../../types/dashboard';

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
    copied: boolean;
    setCopied: (v: boolean) => void;
    taskId: string;
    onLaunchInteractiveResume: () => void;
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
        metadataProcess: any;
        planPath: string;
        createdFiles: { filePath: string }[];
        wsId?: string;
        sessionTokenLimit: number | undefined;
        sessionCurrentTokens: number | undefined;
        sessionModel: string | undefined;
        variant: 'inline' | 'floating';
        isPopOut: boolean;
        isMobile: boolean;
        isFloatingChat: boolean;
        taskId: string;
        onFloat: () => void;
        onPopOut: () => void;
        onCopyHtml: () => void;
        copiedHtml: boolean;
        onOpenRefs?: () => void;
        onToggleSelecting?: () => void;
        isSelecting?: boolean;
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

    // Metadata
    if (!props.isPending && props.metadataProcess) {
        items.push({
            key: 'metadata',
            label: 'Metadata',
            icon: <span className="text-[10px] font-semibold">i</span>,
            onClick: () => { /* handled via render */ },
            render: () => (
                <ConversationMetadataPopover process={props.metadataProcess} turnsCount={props.turns.length} />
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

    // Resume CLI
    if (!props.isPending && props.resumeSessionId) {
        items.push({
            key: 'resume-cli',
            label: 'Resume CLI',
            icon: <span className="text-xs">▶</span>,
            onClick: props.onLaunchInteractiveResume,
        });
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
                />
            ),
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
    copied,
    setCopied,
    taskId,
    onLaunchInteractiveResume,
    onPopOut,
    onFloat,
    title,
    wsId,
    turnsContainerRef,
    isSelecting,
    onToggleSelecting,
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

    const isWide = tier === 'wide';
    const isNarrow = tier === 'narrow';
    const showFloatPopout = isWide || (!isNarrow);

    const overflowItems = useMemo(() => buildOverflowItems(tier, {
        task,
        loading,
        turns,
        isPending,
        resumeSessionId,
        resumeLaunching,
        onLaunchInteractiveResume,
        metadataProcess,
        planPath,
        createdFiles,
        wsId,
        sessionTokenLimit,
        sessionCurrentTokens,
        sessionModel,
        variant,
        isPopOut,
        isMobile,
        isFloatingChat: isFloating(taskId),
        taskId,
        onFloat,
        onPopOut,
        onCopyHtml: () => void handleCopyHtml(),
        copiedHtml,
        onOpenRefs: () => setRefsSheetOpen(true),
        onToggleSelecting,
        isSelecting,
    }), [tier, task, loading, turns, isPending, resumeSessionId, resumeLaunching, metadataProcess, planPath, createdFiles, sessionTokenLimit, sessionCurrentTokens, sessionModel, variant, isPopOut, isMobile, taskId, copiedHtml, onFloat, onPopOut, onLaunchInteractiveResume, isFloating, wsId, onToggleSelecting, isSelecting]); // eslint-disable-line react-hooks/exhaustive-deps

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
                <span className={cn(
                    'text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]',
                    isNarrow && 'truncate max-w-[120px]',
                )}>
                    {title ?? 'Chat'}
                </span>
                {task && (
                    <Badge status={task.status}>
                        {statusIcon(task.status)}{isWide ? ` ${statusLabel(task.status, task.type)}` : ''}
                    </Badge>
                )}
                {/* References, duration, Resume CLI, context window — only in wide tier */}
                {isWide && (
                    <>
                        <ReferencesDropdown planPath={planPath} files={createdFiles} wsId={wsId} />
                        {task?.duration != null && (
                            <span className="text-xs text-[#848484]">{formatDuration(task.duration)}</span>
                        )}
                        {!isPending && resumeSessionId && (
                            <Button
                                variant="secondary"
                                size="sm"
                                loading={resumeLaunching}
                                onClick={onLaunchInteractiveResume}
                            >
                                Resume CLI
                            </Button>
                        )}
                        <ContextWindowIndicator
                            tokenLimit={sessionTokenLimit}
                            currentTokens={sessionCurrentTokens}
                            modelName={sessionModel}
                            className="flex ml-2 max-w-[180px]"
                        />
                    </>
                )}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2 flex-shrink-0">
                {/* Float / Popout buttons — shown in wide + medium, hidden in narrow (moved to overflow) */}
                {showFloatPopout && variant !== 'floating' && !isPopOut && !isMobile && !isFloating(taskId) && (
                    <button
                        title="Float in current window"
                        data-testid="activity-chat-float-btn"
                        onClick={onFloat}
                        className="inline-flex items-center justify-center p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
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
                        className="inline-flex items-center justify-center p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
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
                    className="inline-flex items-center justify-center p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
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
                {/* Copy HTML + Metadata — inline only in wide tier */}
                {isWide && (
                    <>
                        <button
                            title="Copy conversation as HTML"
                            data-testid="copy-conversation-html-btn"
                            disabled={loading || turns.length === 0}
                            onClick={() => void handleCopyHtml()}
                            className="inline-flex items-center justify-center px-1 py-0.5 rounded text-[10px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                        >
                            {copiedHtml ? '✓' : 'HTML'}
                        </button>
                        {onToggleSelecting && turns.length > 0 && (
                            <button
                                title={isSelecting ? 'Cancel selection' : 'Select turns for partial copy'}
                                data-testid="select-turns-btn"
                                onClick={onToggleSelecting}
                                className={cn(
                                    'inline-flex items-center justify-center px-1 py-0.5 rounded text-[10px] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0',
                                    isSelecting
                                        ? 'text-[#0078d4] dark:text-[#3794ff] font-medium'
                                        : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                )}
                            >
                                {isSelecting ? '✕ Cancel' : '☐ Select'}
                            </button>
                        )}
                        {!isPending && metadataProcess && (
                            <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />
                        )}
                    </>
                )}
                {/* Overflow menu — shown at < 700px */}
                {!isWide && <ChatHeaderOverflowMenu items={overflowItems} wsId={wsId} />}
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
