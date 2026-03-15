/**
 * buildNotificationEntry — pure utility that converts an AIProcess-like payload
 * into the input shape expected by NotificationContext.addNotification().
 */

export interface ProcessLike {
    id: string;
    status: string;
    promptPreview?: string | null;
    startTime?: string | Date | null;
    endTime?: string | Date | null;
    metadata?: { workspaceId?: string } | null;
}

export interface NotificationEntryInput {
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    detail: string;
    processId: string;
}

const STATUS_TYPE_MAP: Record<string, NotificationEntryInput['type']> = {
    completed: 'success',
    failed: 'error',
    cancelled: 'warning',
};

export function buildNotificationEntry(process: ProcessLike, workspaceName?: string): NotificationEntryInput {
    const durationSec = process.endTime && process.startTime
        ? Math.round((+new Date(process.endTime as string) - +new Date(process.startTime as string)) / 1000)
        : null;
    const workspaceLabel = workspaceName ?? process.metadata?.workspaceId ?? null;
    const detail = [durationSec != null ? `${durationSec}s` : null, workspaceLabel]
        .filter(Boolean).join(' · ');
    const promptLabel = process.promptPreview ?? 'Run';
    const title = workspaceName
        ? `[${workspaceName}] ${promptLabel} ${process.status}`
        : `${promptLabel} ${process.status}`;

    return {
        type: STATUS_TYPE_MAP[process.status] ?? 'info',
        title,
        detail,
        processId: process.id,
    };
}
