/**
 * GitPanelHeader — fixed header strip for the git left panel.
 *
 * Shows branch name pill, ahead/behind badge, and a refresh button
 * that spins while refreshing.
 */

interface GitPanelHeaderProps {
    branch: string;
    ahead: number;
    behind: number;
    refreshing: boolean;
    onRefresh: () => void;
    onFetch?: () => void;
    onPull?: () => void;
    onPush?: () => void;
    fetching?: boolean;
    pulling?: boolean;
    pushing?: boolean;
}

const spinKeyframes = `@keyframes gitRefreshSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .git-refresh-spin { animation: gitRefreshSpin 1s linear infinite; }`;

export function GitPanelHeader({ branch, ahead, behind, refreshing, onRefresh, onFetch, onPull, onPush, fetching, pulling, pushing }: GitPanelHeaderProps) {
    const hasAheadBehind = ahead > 0 || behind > 0;

    return (
        <>
            <style>{spinKeyframes}</style>
            <div
            className="git-panel-header flex items-center gap-2 px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#252526] sticky top-0 z-20"
            data-testid="git-panel-header"
        >
            {/* Branch pill */}
            <span
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono font-medium bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#ccc] rounded-full truncate max-w-[360px]"
                title={branch}
                data-testid="git-branch-pill"
            >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6A1.5 1.5 0 004.5 10v.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.993 2.993 0 016 6.5h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
                </svg>
                {branch}
            </span>

            {/* Ahead/behind badge */}
            {hasAheadBehind && (
                <span
                    className="inline-flex items-center gap-1 text-xs text-[#616161] dark:text-[#999]"
                    data-testid="git-ahead-behind-badge"
                >
                    {ahead > 0 && <span className="text-[#16825d]" data-testid="git-ahead-count">↑{ahead}</span>}
                    {behind > 0 && <span className="text-[#d32f2f]" data-testid="git-behind-count">↓{behind}</span>}
                </span>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Git action buttons */}
            {onFetch && (
                <button
                    className="git-action-btn flex items-center gap-1 px-1.5 py-0.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors text-[#616161] dark:text-[#999] disabled:opacity-50"
                    onClick={onFetch}
                    disabled={fetching}
                    title="Fetch from remote"
                    data-testid="git-fetch-btn"
                >
                    <svg className={`w-3 h-3 ${fetching ? 'git-refresh-spin' : ''}`} viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1a.5.5 0 01.5.5v5.793l2.146-2.147a.5.5 0 01.708.708l-3 3a.5.5 0 01-.708 0l-3-3a.5.5 0 11.708-.708L7.5 7.293V1.5A.5.5 0 018 1zM2 13.5a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z" />
                    </svg>
                    Fetch
                </button>
            )}
            {onPull && (
                <button
                    className="git-action-btn flex items-center gap-1 px-1.5 py-0.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors text-[#616161] dark:text-[#999] disabled:opacity-50"
                    onClick={onPull}
                    disabled={pulling}
                    title="Pull --rebase from remote"
                    data-testid="git-pull-btn"
                >
                    <svg className={`w-3 h-3 ${pulling ? 'git-refresh-spin' : ''}`} viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" d="M8 1a.5.5 0 01.5.5v11.793l3.146-3.147a.5.5 0 01.708.708l-4 4a.5.5 0 01-.708 0l-4-4a.5.5 0 01.708-.708L7.5 13.293V1.5A.5.5 0 018 1z" />
                    </svg>
                    Pull
                </button>
            )}
            {onPush && (
                <button
                    className="git-action-btn flex items-center gap-1 px-1.5 py-0.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors text-[#616161] dark:text-[#999] disabled:opacity-50"
                    onClick={onPush}
                    disabled={pushing}
                    title="Push to remote"
                    data-testid="git-push-btn"
                >
                    <svg className={`w-3 h-3 ${pushing ? 'git-refresh-spin' : ''}`} viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" d="M8 15a.5.5 0 01-.5-.5V2.707L4.354 5.854a.5.5 0 11-.708-.708l4-4a.5.5 0 01.708 0l4 4a.5.5 0 01-.708.708L8.5 2.707V14.5a.5.5 0 01-.5.5z" />
                    </svg>
                    Push
                </button>
            )}

            {/* Refresh button */}
            <button
                className="git-refresh-btn flex items-center justify-center w-6 h-6 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] transition-colors text-[#616161] dark:text-[#999] disabled:opacity-50"
                onClick={onRefresh}
                disabled={refreshing}
                title="Refresh git data"
                data-testid="git-refresh-btn"
            >
                <svg
                    className={`w-3.5 h-3.5 ${refreshing ? 'git-refresh-spin' : ''}`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    data-testid="git-refresh-icon"
                >
                    <path fillRule="evenodd" d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.418A6 6 0 118 2v1z" />
                    <path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 018 4.466z" />
                </svg>
            </button>
        </div>
        </>
    );
}
