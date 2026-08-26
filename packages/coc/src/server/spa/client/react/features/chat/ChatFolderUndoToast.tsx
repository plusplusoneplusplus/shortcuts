/**
 * ChatFolderUndoToast — the single-level undo offered after a folder is
 * deleted (AC-05).
 *
 * The app's shared toast is message-only, so folder deletion gets its own
 * toast: an undo needs a button, and this one has to survive long enough to be
 * clicked. Dismissing it (or navigating away, which unmounts it) means the
 * deletion stands.
 */
import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

/** How long the undo stays on screen. Longer than the plain toast — it is an action. */
export const CHAT_FOLDER_UNDO_TIMEOUT_MS = 8000;

export interface ChatFolderUndoToastProps {
    folderName: string;
    /** Chats that were unfiled by the delete; 0 for an empty folder. */
    memberCount: number;
    onUndo: () => void;
    onDismiss: () => void;
}

export function ChatFolderUndoToast({
    folderName,
    memberCount,
    onUndo,
    onDismiss,
}: ChatFolderUndoToastProps): React.ReactElement | null {
    // A timer that outlives the component fires setState into a torn-down tree,
    // which vitest reports as an unhandled error even when every test passes.
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;
    useEffect(() => {
        const timer = setTimeout(() => dismissRef.current(), CHAT_FOLDER_UNDO_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [folderName, memberCount]);

    if (typeof document === 'undefined') {return null;}

    const suffix = memberCount === 0
        ? ''
        : memberCount === 1 ? ' · 1 chat unfiled' : ` · ${memberCount} chats unfiled`;

    return ReactDOM.createPortal(
        <div
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[10001] flex items-center gap-3 px-4 py-2.5 rounded-md shadow-lg bg-[#252526] text-white text-[12.5px]"
            role="status"
            data-testid="chat-folder-undo-toast"
        >
            <span className="max-w-[280px] truncate">Deleted “{folderName}”{suffix}</span>
            <button
                type="button"
                className="shrink-0 font-semibold text-[#3794ff] hover:underline"
                onClick={onUndo}
                data-testid="chat-folder-undo-btn"
            >
                Undo
            </button>
            <button
                type="button"
                className="shrink-0 text-[#a0a0a0] hover:text-white leading-none"
                onClick={onDismiss}
                aria-label="Dismiss"
                data-testid="chat-folder-undo-dismiss"
            >✕</button>
        </div>,
        document.body,
    );
}
