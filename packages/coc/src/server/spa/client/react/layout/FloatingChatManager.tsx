/**
 * FloatingChatManager — renders a FloatingDialog for each floating chat entry.
 *
 * Mounted at the App level (above the Router) so floating chats persist across
 * tab navigation. Each chat gets its own independent minimize state tracked via
 * useMinimizedDialog for tray-pill integration.
 */

import { useCallback, useMemo, useState } from 'react';
import { FloatingDialog } from '../shared/FloatingDialog';
import { Spinner } from '../shared';
import { FloatingChatContent } from '../repos/FloatingChatContent';
import { useFloatingChats, type FloatingChatEntry } from '../context/FloatingChatsContext';
import { useMinimizedDialog } from '../context/MinimizedDialogsContext';

// ── Per-chat item ─────────────────────────────────────────────────────────────

interface FloatingChatItemProps {
    entry: FloatingChatEntry;
}

function FloatingChatItem({ entry }: FloatingChatItemProps) {
    const { unfloatChat } = useFloatingChats();
    const [minimized, setMinimized] = useState(false);

    const handleClose = useCallback(() => {
        unfloatChat(entry.taskId);
    }, [entry.taskId, unfloatChat]);

    const handleMinimize = useCallback(() => setMinimized(true), []);
    const handleRestore = useCallback(() => setMinimized(false), []);

    const isRunning = entry.status === 'running';

    const minimizedEntry = useMemo(() => {
        if (!minimized) return null;
        return {
            id: `floating-chat-${entry.taskId}`,
            icon: '💬',
            label: entry.title || 'Chat',
            onRestore: handleRestore,
            onClose: handleClose,
            extra: isRunning ? <Spinner size="sm" /> : undefined,
        };
    }, [minimized, entry.taskId, entry.title, handleRestore, handleClose, isRunning]);

    useMinimizedDialog(minimizedEntry);

    if (minimized) return null;

    return (
        <FloatingDialog
            open={true}
            onClose={handleClose}
            onMinimize={handleMinimize}
            title={entry.title || 'Chat'}
            resizable
            minWidth={480}
            minHeight={400}
            className="max-h-[80vh]"
            noPadding
            id={`floating-chat-${entry.taskId}`}
        >
            <FloatingChatContent taskId={entry.taskId} workspaceId={entry.workspaceId} />
        </FloatingDialog>
    );
}

// ── Manager ───────────────────────────────────────────────────────────────────

/**
 * Renders above the Router so floating chats persist across tab navigation.
 * Add to App.tsx after <Router />.
 */
export function FloatingChatManager() {
    const { floatingChats } = useFloatingChats();

    if (floatingChats.size === 0) return null;

    return (
        <>
            {Array.from(floatingChats.values()).map(entry => (
                <FloatingChatItem key={entry.taskId} entry={entry} />
            ))}
        </>
    );
}
