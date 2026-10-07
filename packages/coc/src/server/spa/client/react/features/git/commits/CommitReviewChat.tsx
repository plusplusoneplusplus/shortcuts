import { CommitChatPanel } from './CommitChatPanel';
import { CommitChatPlacementFrame } from './CommitChatPlacementFrame';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import type { UseCommitChatPresentationReturn } from '../hooks/useCommitChatPresentation';

/** Shared chat placement; the caller determines the lifetime of the commit host. */
export function CommitReviewChat({ workspaceId, hash, commitMessage, chat }: {
    workspaceId: string;
    hash?: string;
    commitMessage?: string;
    chat: UseCommitChatPresentationReturn;
}) {
    const chatResize = useResizablePanel({
        initialWidth: 360, minWidth: 200, maxWidth: 600,
        storageKey: 'coc.commitChatPanel.width', direction: 'right',
    });
    if (!chat.chatOpen || !hash) {
        return null;
    }
    if (chat.presentation === 'lens') {
        return <CommitChatPlacementFrame
            workspaceId={workspaceId}
            commitHash={hash}
            commitMessage={commitMessage}
            presentation="lens"
            onClose={chat.closeChat}
            isMinimized={chat.isMinimized}
            onMinimize={chat.minimizeChat}
            onRestore={chat.restoreChat}
            onPin={chat.pinChat}
        />;
    }
    return <>
        <div
            className="hidden lg:flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 bg-[#e0e0e0] dark:bg-[#3c3c3c] shrink-0"
            onMouseDown={chatResize.handleMouseDown}
            onTouchStart={chatResize.handleTouchStart}
            role="separator"
            aria-label="Resize chat panel"
        />
        <div style={{ width: chatResize.width }} className="shrink-0 h-full">
            {chat.lensEnabled && chat.isPinned ? (
                <CommitChatPlacementFrame
                    workspaceId={workspaceId}
                    commitHash={hash}
                    commitMessage={commitMessage}
                    presentation="side-panel"
                    onClose={chat.closeChat}
                    onUnpin={chat.unpinChat}
                />
            ) : (
                <CommitChatPanel
                    workspaceId={workspaceId}
                    commitHash={hash}
                    commitMessage={commitMessage}
                    onClose={chat.toggleChat}
                />
            )}
        </div>
    </>;
}
