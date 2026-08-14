import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { TocEntry } from '../noteTocUtils';
import { NoteTocPanel } from '../NoteTocPanel';

/**
 * Right-end toolbar controls owned by the host rather than by the editor.
 *
 * Unlike the formatting commands these read no editor state — every one of them
 * is driven by a prop from `NoteEditor`, and they stay visible in source mode.
 */
export interface ToolbarHostActionsProps {
    commentsPanelOpen?: boolean;
    onToggleCommentsPanel?: () => void;
    commentCount?: number;
    aiEditCount?: number;
    onToggleAiEdits?: () => void;
    aiEditsVisible?: boolean;
    toolbarRight?: ReactNode;
    onRefresh?: () => void;
    refreshing?: boolean;
    chatPanelOpen?: boolean;
    onToggleChatPanel?: () => void;
    chatDisabledReason?: string;
    hasExistingChat?: boolean;
    tocOpen?: boolean;
    onToggleToc?: () => void;
    tocEntries?: TocEntry[];
    tocActiveIndex?: number | null;
    onTocJump?: (entry: TocEntry) => void;
}

/**
 * Whether any host action is present. The caller uses this to decide whether to
 * emit the `ml-auto` spacer at all, so a toolbar with no host actions does not
 * grow an invisible right-hand group.
 */
export function hasHostActions(props: ToolbarHostActionsProps): boolean {
    return Boolean(
        props.onToggleCommentsPanel
        || props.toolbarRight
        || props.onRefresh
        || props.onToggleChatPanel
        || props.chatDisabledReason
        || props.onToggleToc
        || (props.aiEditCount ?? 0) > 0,
    );
}

export function ToolbarHostActions({
    commentsPanelOpen,
    onToggleCommentsPanel,
    commentCount,
    aiEditCount,
    onToggleAiEdits,
    aiEditsVisible,
    toolbarRight,
    onRefresh,
    refreshing,
    chatPanelOpen,
    onToggleChatPanel,
    chatDisabledReason,
    hasExistingChat,
    tocOpen,
    onToggleToc,
    tocEntries = [],
    tocActiveIndex = null,
    onTocJump,
}: ToolbarHostActionsProps) {
    const tocRef = useRef<HTMLDivElement>(null);
    const hasHeadings = tocEntries.length > 0;

    return (
        <>
            <div className="ml-auto" />
            {(aiEditCount ?? 0) > 0 && onToggleAiEdits && (
                <button
                    type="button"
                    className={
                        'text-xs px-2 py-0.5 rounded ' +
                        (aiEditsVisible
                            ? 'bg-[#e8f5e9] dark:bg-[#1b3a1b] text-green-700 dark:text-green-300'
                            : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                    }
                    onClick={onToggleAiEdits}
                    title={aiEditsVisible ? 'Hide AI changes' : 'Show AI changes'}
                    data-testid="ai-edits-toggle"
                >
                    ✦ {aiEditCount}
                </button>
            )}
            {onToggleCommentsPanel && (
                <button
                    type="button"
                    className={
                        'text-xs px-2 py-0.5 rounded ' +
                        (commentsPanelOpen
                            ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                            : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                    }
                    onClick={onToggleCommentsPanel}
                    data-testid="comments-panel-toggle"
                    aria-label={commentsPanelOpen ? 'Hide comments' : 'Show comments'}
                >
                    💬{(commentCount ?? 0) > 0 && (
                        <span className="ml-1 text-[10px]" data-testid="comments-toggle-count">
                            {commentCount}
                        </span>
                    )}
                </button>
            )}
            {(onToggleChatPanel || chatDisabledReason) && (
                <button
                    type="button"
                    className={
                        'text-xs px-2 py-0.5 rounded ' +
                        (chatDisabledReason
                            ? 'text-[#8c959f] dark:text-[#555] cursor-not-allowed'
                            : chatPanelOpen
                            ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                            : hasExistingChat
                                ? 'text-[#0078d4] dark:text-[#3794ff] hover:bg-[#e0eef9] dark:hover:bg-[#1a3a5c]'
                                : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                    }
                    onClick={onToggleChatPanel}
                    disabled={Boolean(chatDisabledReason)}
                    data-testid="chat-panel-toggle"
                    aria-label={chatDisabledReason ?? (chatPanelOpen ? 'Hide AI chat' : hasExistingChat ? 'Continue AI chat' : 'Show AI chat')}
                    title={chatDisabledReason ?? (chatPanelOpen ? 'Hide AI chat' : hasExistingChat ? 'Continue AI chat' : 'Show AI chat')}
                >
                    🤖
                </button>
            )}
            {onToggleToc && (
                <div className="relative" ref={tocRef}>
                    <button
                        type="button"
                        title={hasHeadings ? 'Table of contents' : 'No headings in this note'}
                        aria-label="Table of contents"
                        disabled={!hasHeadings}
                        className={
                            'text-xs px-2 py-0.5 rounded ' +
                            (tocOpen && hasHeadings
                                ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                : !hasHeadings
                                    ? 'opacity-40 cursor-not-allowed text-[#888]'
                                    : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                        }
                        onClick={onToggleToc}
                        data-testid="toc-toggle-btn"
                    >
                        ≡
                    </button>
                    {tocOpen && hasHeadings && onTocJump && (
                        <NoteTocPanel
                            entries={tocEntries}
                            activeIndex={tocActiveIndex}
                            onJump={onTocJump}
                            onClose={onToggleToc}
                        />
                    )}
                </div>
            )}
            {onRefresh && (
                <button
                    type="button"
                    className="text-xs px-2 py-0.5 rounded text-[#888] hover:text-[#333] dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={onRefresh}
                    disabled={refreshing}
                    aria-label="Refresh"
                    title="Refresh (Ctrl+Shift+R)"
                    data-testid="note-editor-refresh-btn"
                >
                    ↻
                </button>
            )}
            {toolbarRight}
        </>
    );
}
