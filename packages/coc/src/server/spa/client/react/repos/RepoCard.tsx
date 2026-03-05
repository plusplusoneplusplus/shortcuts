/**
 * RepoCard — single repo entry in the sidebar.
 * Shows color dot, name, branch badge, truncated path, and stats.
 */

import type { RepoData } from './repoGrouping';
import { truncatePath } from './repoGrouping';
import { Card, cn } from '../shared';
import { useRepoQueueStats } from '../hooks/useRepoQueueStats';

interface RepoCardProps {
    repo: RepoData;
    isSelected: boolean;
    inGroup?: boolean;
    onClick: () => void;
}

export function RepoCard({ repo, isSelected, inGroup, onClick }: RepoCardProps) {
    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const branch = repo.gitInfo?.branch || 'n/a';
    const gitInfoLoading = repo.gitInfoLoading ?? false;
    const pipelineCount = repo.pipelines?.length || 0;
    const stats = repo.stats || { success: 0, failed: 0, running: 0 };
    const truncPath = truncatePath(ws.rootPath || '', 24);
    const taskCount = repo.taskCount || 0;
    const queueStats = useRepoQueueStats(ws.id);

    return (
        <Card
            onClick={onClick}
            className={cn(
                'repo-item p-1.5',
                inGroup && 'ml-4',
                isSelected && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]'
            )}
        >
            {/* Line 1 — identity: dot + name + branch badge + task count */}
            <div className="flex items-center gap-1.5">
                <span
                    className="repo-color-dot inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: color }}
                />
                <span className="repo-item-name text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                    {ws.name}
                </span>
                {gitInfoLoading ? (
                    <span
                        data-testid="git-info-loading"
                        className="text-[10px] px-1 py-px rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-transparent animate-pulse flex-shrink-0 select-none"
                        aria-label="Loading branch info"
                    >
                        {'···'}
                    </span>
                ) : branch !== 'n/a' && (
                    <span className="text-[10px] px-1 py-px rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999] flex-shrink-0">
                        {branch}
                    </span>
                )}
                {taskCount > 0 && (
                    <span className="text-[10px] text-[#848484] flex-shrink-0">· {taskCount}</span>
                )}
            </div>

            {/* Line 2 — path + stats */}
            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[#848484]">
                <span className="truncate min-w-0" title={ws.rootPath || ''}>{truncPath}</span>
                <span className="flex-shrink-0">Pipelines: {pipelineCount}</span>
                {(queueStats.running > 0 || queueStats.queued > 0) && (
                    <span className="queue-status flex-shrink-0" data-testid="repo-card-queue-status">
                        {queueStats.running > 0 && <span data-testid="repo-card-queue-running">⏳{queueStats.running}</span>}
                        {queueStats.running > 0 && queueStats.queued > 0 && ' '}
                        {queueStats.queued > 0 && <span data-testid="repo-card-queue-queued">⏸{queueStats.queued}</span>}
                    </span>
                )}
                <span className="repo-stat-counts ml-auto flex-shrink-0">
                    ✓{stats.success} ✗{stats.failed} ⏗{stats.running}
                </span>
            </div>
        </Card>
    );
}
