/**
 * SyncStatusIndicator — compact pill shown in the TopBar when sync is enabled.
 *
 * Shows one of four states:
 *   ● syncing (pulse, amber)   — sync in progress
 *   ● error   (red)            — last sync failed
 *   ● ok      (green)          — last sync succeeded
 *   ● hidden                   — sync disabled / not configured
 *
 * Clicking the pill triggers a manual sync.
 */

import type { SyncStatus } from '@plusplusoneplusplus/coc-client';

export interface SyncStatusIndicatorProps {
    status: SyncStatus | null;
    onTriggerSync?: () => void;
}

interface SyncVisual {
    dot: string;
    label: string;
    pulse: boolean;
    title: string;
}

function getSyncVisual(status: SyncStatus): SyncVisual {
    if (status.inProgress) {
        return {
            dot: 'bg-[#cca700] dark:bg-[#cca700]',
            label: 'Syncing…',
            pulse: true,
            title: 'Sync in progress',
        };
    }
    if (status.lastError) {
        return {
            dot: 'bg-[#f14c4c] dark:bg-[#f48771]',
            label: 'Sync error',
            pulse: false,
            title: `Sync error: ${status.lastError}`,
        };
    }
    if (status.lastSyncTime) {
        const ts = new Date(status.lastSyncTime).toLocaleTimeString();
        return {
            dot: 'bg-[#16825d] dark:bg-[#89d185]',
            label: 'Synced',
            pulse: false,
            title: `Last synced: ${ts}`,
        };
    }
    return {
        dot: 'bg-[#656d76] dark:bg-[#999]',
        label: 'Sync',
        pulse: false,
        title: 'Sync enabled, never synced',
    };
}

export function SyncStatusIndicator({ status, onTriggerSync }: SyncStatusIndicatorProps) {
    if (!status?.enabled) return null;

    const visual = getSyncVisual(status);

    return (
        <>
            {/* Desktop pill */}
            <button
                type="button"
                className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs font-medium text-[#656d76] dark:text-[#999] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a] transition-colors"
                title={visual.title}
                aria-label={visual.title}
                data-testid="sync-status-topbar"
                onClick={onTriggerSync}
                disabled={status.inProgress}
            >
                <span
                    className={`inline-block w-2 h-2 rounded-full ${visual.dot}${visual.pulse ? ' animate-pulse' : ''}`}
                    aria-hidden="true"
                />
                <span data-testid="sync-status-topbar-label">{visual.label}</span>
            </button>
            {/* Mobile dot */}
            <button
                type="button"
                className="md:hidden inline-flex items-center justify-center h-7 w-7"
                title={visual.title}
                aria-label={visual.title}
                data-testid="sync-status-topbar-mobile"
                onClick={onTriggerSync}
                disabled={status.inProgress}
            >
                <span
                    className={`inline-block w-2 h-2 rounded-full ${visual.dot}${visual.pulse ? ' animate-pulse' : ''}`}
                />
            </button>
        </>
    );
}
