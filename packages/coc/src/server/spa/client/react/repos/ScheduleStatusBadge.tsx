/** Micro-components: StatusDot, StatusBadge, failureLabel. */

export function StatusDot({ status, isRunning }: { status: string; isRunning: boolean }) {
    if (isRunning) return <span title="Running">🔵</span>;
    switch (status) {
        case 'active': return <span title="Active">🟢</span>;
        case 'paused': return <span title="Paused">⏸</span>;
        case 'stopped': return <span title="Stopped">🔴</span>;
        default: return <span>⚪</span>;
    }
}

/** Status badge pill for Active / Paused / Running states. */
export function StatusBadge({ status, isRunning }: { status: string; isRunning: boolean }) {
    if (isRunning) {
        return (
            <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                aria-label="Status: Running"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                Running
            </span>
        );
    }
    if (status === 'active') {
        return (
            <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                aria-label="Status: Active"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Active
            </span>
        );
    }
    if (status === 'paused') {
        return (
            <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300"
                aria-label="Status: Paused"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                Paused
            </span>
        );
    }
    return (
        <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-[#f3f3f3] dark:bg-[#333] text-[#848484]"
            aria-label={`Status: ${status}`}
            data-testid="status-badge"
        >
            {status}
        </span>
    );
}

/** Friendly label for onFailure raw values. */
export function failureLabel(raw: string): string {
    switch (raw) {
        case 'continue': return 'Continue on failure';
        case 'stop': return 'Stop on failure';
        case 'notify': return 'Notify on failure';
        default: return raw;
    }
}
