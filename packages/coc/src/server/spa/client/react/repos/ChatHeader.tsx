import { Badge } from '../shared';
import { Button } from '../shared';
import { ReferencesDropdown } from '../shared/ReferencesDropdown';
import { ConversationMetadataPopover } from '../processes/ConversationMetadataPopover';
import { ContextWindowIndicator } from '../components/ContextWindowIndicator';
import { copyToClipboard, formatConversationAsText, formatDuration, statusIcon, statusLabel } from '../utils/format';
import { cn } from '../shared/cn';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useFloatingChats } from '../context/FloatingChatsContext';
import type { ClientConversationTurn } from '../types/dashboard';

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
}: ChatHeaderProps) {
    const { isMobile } = useBreakpoint();
    const { isFloating } = useFloatingChats();

    return (
        <div className={cn(
            'flex items-center justify-between',
            variant === 'floating'
                ? 'px-2 py-2'
                : 'px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]',
        )}>
            <div className="flex items-center gap-2 min-w-0">
                {onBack && variant !== 'floating' && (
                    <button
                        className="inline-flex items-center justify-center min-h-7 min-w-7 px-2 text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff] mr-1"
                        onClick={onBack}
                        data-testid="activity-chat-back-btn"
                    >
                        ← Back
                    </button>
                )}
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat</span>
                {task && (
                    <Badge status={task.status}>
                        {statusIcon(task.status)} {statusLabel(task.status)}
                    </Badge>
                )}
                <ReferencesDropdown planPath={planPath} files={createdFiles} />
                {task?.duration != null && (
                    <span className="text-xs text-[#848484]">{formatDuration(task.duration)}</span>
                )}
                {!isPending && resumeSessionId && (
                    <Button
                        variant="secondary"
                        size="sm"
                        className="hidden sm:inline-flex"
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
                    className="hidden sm:flex ml-2 max-w-[180px]"
                />
            </div>
            <div className="flex items-center gap-2">
                {variant !== 'floating' && !isPopOut && !isMobile && !isFloating(taskId) && (
                    <button
                        title="Float in current window"
                        data-testid="activity-chat-float-btn"
                        onClick={onFloat}
                        className="p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                            <path d="M2 6h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                    </button>
                )}
                {!isPopOut && !isMobile && variant !== 'floating' && (
                    <button
                        title="Pop out to new window"
                        data-testid="activity-chat-popout-btn"
                        onClick={onPopOut}
                        className="p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M10 2h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M14 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                    </button>
                )}
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
                    className="p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
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
                {!isPending && metadataProcess && (
                    <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />
                )}
            </div>
        </div>
    );
}
