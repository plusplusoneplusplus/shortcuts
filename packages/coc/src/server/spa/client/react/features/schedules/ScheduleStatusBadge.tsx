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
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium leading-4 bg-[#ddf4ff] dark:bg-blue-900/40 text-[#0969da] dark:text-blue-300 border border-[#b6e3ff] dark:border-blue-700/60"
                aria-label="Status: Running"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-[#0969da] dark:bg-blue-400 animate-pulse inline-block" />
                Running
            </span>
        );
    }
    if (status === 'active') {
        return (
            <span
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium leading-4 bg-[#dafbe1] dark:bg-green-900/40 text-[#1a7f37] dark:text-green-300 border border-[#aceebb] dark:border-green-700/60"
                aria-label="Status: Active"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-[#1a7f37] dark:bg-green-400 inline-block" />
                Active
            </span>
        );
    }
    if (status === 'paused') {
        return (
            <span
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium leading-4 bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[#656d76] dark:text-[#848484] border border-[#d0d7de] dark:border-[#3c3c3c]"
                aria-label="Status: Paused"
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-[#6e7781] dark:bg-[#848484] inline-block" />
                Paused
            </span>
        );
    }
    if (status === 'failed' || status === 'stopped') {
        return (
            <span
                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium leading-4 bg-[#ffebe9] dark:bg-red-900/40 text-[#cf222e] dark:text-red-300 border border-[#ffcecb] dark:border-red-700/60"
                aria-label={`Status: ${status === 'failed' ? 'Failed' : 'Stopped'}`}
                data-testid="status-badge"
            >
                <span className="w-1.5 h-1.5 rounded-full bg-[#cf222e] dark:bg-red-400 inline-block" />
                {status === 'failed' ? 'Failed' : 'Stopped'}
            </span>
        );
    }
    return (
        <span
            className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium leading-4 bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[#656d76] dark:text-[#848484] border border-[#d0d7de] dark:border-[#3c3c3c]"
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
