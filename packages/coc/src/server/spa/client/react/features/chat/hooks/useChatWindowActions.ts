import { useCallback, useContext } from 'react';
import { ToastContext } from '../../../contexts/ToastContext';
import { usePopOut } from '../../../contexts/PopOutContext';
import { useFloatingChats } from '../../../contexts/FloatingChatsContext';
import { lookupCloneBaseUrl } from '../../../repos/cloneRegistry';
import type { ToastItem } from '../../../ui/Toast';
import { popOutOpened } from '../../../utils/popOutWindow';

export interface UseChatWindowActionsOptions {
    task: any;
    taskId: string;
    workspaceId?: string;
    sourceSelectionId?: string;
    sourceBaseUrl?: string;
}

export function buildChatPopOutUrl(base: string, taskId: string, workspaceId?: string, cloneBaseUrl?: string, sourceSelectionId?: string): string {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspace', workspaceId);
    if (cloneBaseUrl) params.set('cloneBaseUrl', cloneBaseUrl);
    if (sourceSelectionId) params.set('sourceSelectionId', sourceSelectionId);
    const query = params.toString();
    return `${base}${query ? `?${query}` : ''}#popout/activity/${encodeURIComponent(taskId)}`;
}

export interface OpenChatPopOutOptions {
    taskId: string;
    workspaceId?: string;
    sourceSelectionId?: string;
    sourceBaseUrl?: string;
    markPoppedOut: (taskId: string) => void;
    addToast?: (message: string, type?: ToastItem['type']) => void;
}

/**
 * Open a chat as a pop-out window. Shared by the chat-header pop-out button
 * (via useChatWindowActions) and the left-panel double-click handler in
 * ChatListPane, so the URL build + blocked-popup toast + markPoppedOut logic
 * lives in exactly one place.
 */
export function openChatPopOut({ taskId, workspaceId, sourceSelectionId, sourceBaseUrl, markPoppedOut, addToast }: OpenChatPopOutOptions): void {
    const base = window.location.origin + window.location.pathname;
    // An explicit local owner must not inherit the active remote clone's endpoint.
    const cloneBaseUrl = sourceBaseUrl ?? (sourceSelectionId === workspaceId
        ? undefined
        : lookupCloneBaseUrl(sourceSelectionId ?? workspaceId));
    const url = buildChatPopOutUrl(base, taskId, workspaceId, cloneBaseUrl, sourceSelectionId);
    const popup = window.open(url, `coc-popout-${taskId}`, 'width=800,height=900');
    if (!popOutOpened(popup)) {
        addToast?.('Pop-out blocked. Allow popups for this site and try again.', 'error');
    } else {
        markPoppedOut(taskId);
    }
}

export function useChatWindowActions({ task, taskId, workspaceId, sourceSelectionId, sourceBaseUrl }: UseChatWindowActionsOptions): {
    handlePopOut: () => void;
    handleFloat: () => void;
} {
    const toastCtx = useContext(ToastContext);
    const { markPoppedOut } = usePopOut();
    const { floatChat } = useFloatingChats();

    const handlePopOut = useCallback(() => {
        openChatPopOut({ taskId, workspaceId, sourceSelectionId, sourceBaseUrl, markPoppedOut, addToast: toastCtx?.addToast });
    }, [taskId, workspaceId, sourceSelectionId, sourceBaseUrl, markPoppedOut, toastCtx]);

    const handleFloat = useCallback(() => {
        const title = task?.payload?.prompt || task?.payload?.promptContent || task?.prompt || 'Chat';
        const shortTitle = typeof title === 'string' ? title.slice(0, 60) : 'Chat';
        floatChat({
            taskId,
            workspaceId,
            title: shortTitle,
            status: task?.status ?? 'running',
        });
    }, [taskId, workspaceId, task, floatChat]);

    return { handlePopOut, handleFloat };
}
