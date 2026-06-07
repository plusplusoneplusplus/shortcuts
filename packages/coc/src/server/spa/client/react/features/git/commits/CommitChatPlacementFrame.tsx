import { CommitChatPanel } from './CommitChatPanel';
import type { CommitChatPresentation } from './commitChatPlacement';

export interface CommitChatPlacementFrameProps {
    workspaceId: string;
    commitHash: string;
    commitMessage?: string;
    presentation: CommitChatPresentation;
    onClose: () => void;
    onPin?: () => void;
    onUnpin?: () => void;
}

export function CommitChatPlacementFrame({
    workspaceId,
    commitHash,
    commitMessage,
    presentation,
    onClose,
    onPin,
    onUnpin,
}: CommitChatPlacementFrameProps) {
    const isLens = presentation === 'lens';
    const rootClassName = isLens
        ? 'absolute bottom-4 right-4 z-30 flex h-[55vh] max-h-[55vh] min-h-[320px] w-[min(420px,calc(100%-2rem))] max-w-[420px] flex-col overflow-hidden rounded-lg border border-[#d0d7de] bg-[#f8f8f8] shadow-2xl dark:border-[#3c3c3c] dark:bg-[#1e1e1e]'
        : 'flex h-full w-full flex-col overflow-hidden bg-[#f8f8f8] dark:bg-[#1e1e1e]';

    return (
        <div
            className={rootClassName}
            data-testid={isLens ? 'commit-chat-lens' : 'commit-chat-side-panel'}
        >
            <div
                className="flex items-center justify-between gap-2 border-b border-[#e0e0e0] px-3 py-2 dark:border-[#3c3c3c]"
                data-testid={isLens ? 'commit-chat-lens-header' : 'commit-chat-side-panel-header'}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        💬 Commit Chat
                    </span>
                    <span className="rounded bg-[#e8e8e8] px-1.5 py-0.5 font-mono text-[10px] text-blue-600 dark:bg-[#333] dark:text-blue-400">
                        {commitHash.slice(0, 7)}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {isLens && onPin && (
                        <button
                            type="button"
                            onClick={onPin}
                            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                            data-testid="commit-chat-pin-btn"
                            title="Pin to side panel"
                        >
                            Pin
                        </button>
                    )}
                    {!isLens && onUnpin && (
                        <button
                            type="button"
                            onClick={onUnpin}
                            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[#0078d4] hover:bg-black/[0.06] dark:text-[#3794ff] dark:hover:bg-white/[0.08]"
                            data-testid="commit-chat-unpin-btn"
                            title="Unpin from side panel"
                        >
                            Unpin
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded px-1 py-0.5 text-xs text-[#848484] hover:bg-black/[0.06] hover:text-[#1e1e1e] dark:hover:bg-white/[0.08] dark:hover:text-white"
                        data-testid="commit-chat-frame-close-btn"
                        title="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div className="min-h-0 flex-1">
                <CommitChatPanel
                    workspaceId={workspaceId}
                    commitHash={commitHash}
                    commitMessage={commitMessage}
                    onClose={onClose}
                    hideEmptyHeader
                />
            </div>
        </div>
    );
}
