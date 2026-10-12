import { cn } from '../../ui';
import { useRailManualRefreshEnabled } from '../../hooks/feature-flags/useRailManualRefreshEnabled';

export function RefreshSidebarButton({ busy, onRefresh }: { busy: boolean; onRefresh: () => Promise<void> }) {
    const enabled = useRailManualRefreshEnabled();
    if (!enabled) { return null; }
    return <button
        type="button"
        data-testid="split-workspace-left-refresh"
        aria-label="Refresh sidebar"
        title="Refresh sidebar"
        aria-busy={busy}
        disabled={busy}
        className="flex h-7 w-7 items-center justify-center rounded text-[#848484] transition-colors hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/50 disabled:opacity-50"
        onClick={() => void onRefresh()}
    >
        <svg className={cn(busy && 'motion-safe:animate-spin')} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M13 6a5.2 5.2 0 1 0 .1 4M13 2v4H9" />
        </svg>
    </button>;
}
