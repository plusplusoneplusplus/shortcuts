import { useCallback, useContext } from 'react';
import { ToastContext } from '../context/ToastContext';
import { usePopOut } from '../context/PopOutContext';
import { useFloatingChats } from '../context/FloatingChatsContext';

export interface UseChatWindowActionsOptions {
    task: any;
    taskId: string;
    workspaceId?: string;
}

export function useChatWindowActions({ task, taskId, workspaceId }: UseChatWindowActionsOptions): {
    handlePopOut: () => void;
    handleFloat: () => void;
} {
    const toastCtx = useContext(ToastContext);
    const { markPoppedOut } = usePopOut();
    const { floatChat } = useFloatingChats();

    const handlePopOut = useCallback(() => {
        const base = window.location.origin + window.location.pathname;
        const wsParam = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : '';
        const url = `${base}${wsParam}#popout/activity/${encodeURIComponent(taskId)}`;
        const popup = window.open(url, `coc-popout-${taskId}`, 'width=800,height=900');
        if (!popup) {
            toastCtx?.addToast('Pop-out blocked. Allow popups for this site and try again.', 'error');
        } else {
            markPoppedOut(taskId);
        }
    }, [taskId, workspaceId, markPoppedOut, toastCtx]);

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
