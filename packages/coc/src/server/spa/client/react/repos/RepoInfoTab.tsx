/**
 * RepoInfoTab — metadata grid and recent processes for a workspace.
 */

import { useState, useEffect } from 'react';
import type { RepoData } from './repoGrouping';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../../utils';

interface RepoInfoTabProps {
    repo: RepoData;
}

const STATUS_ICON: Record<string, string> = {
    running: '⏳', completed: '✓', failed: '✗', cancelled: '🚫', queued: '⏳',
};

export function RepoInfoTab({ repo }: RepoInfoTabProps) {
    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const branch = repo.gitInfo?.branch || 'n/a';
    const dirty = repo.gitInfo?.dirty ? ' (dirty)' : '';
    const ahead = repo.gitInfo?.ahead ?? 0;
    const behind = repo.gitInfo?.behind ?? 0;
    const syncLabel = (ahead === 0 && behind === 0)
        ? 'synced'
        : [ahead > 0 ? `↑ ${ahead} ahead` : '', behind > 0 ? `↓ ${behind} behind` : '']
            .filter(Boolean).join(' · ');
    const stats = repo.stats || { success: 0, failed: 0, running: 0 };
    const remoteUrl = ws.remoteUrl || repo.gitInfo?.remoteUrl || null;

    const [processes, setProcesses] = useState<any[]>([]);
    const [loadingProcesses, setLoadingProcesses] = useState(true);

    useEffect(() => {
        setLoadingProcesses(true);
        fetchApi(`/processes?workspace=${encodeURIComponent(ws.id)}&limit=10`)
            .then(res => setProcesses(res?.processes || []))
            .catch(() => setProcesses([]))
            .finally(() => setLoadingProcesses(false));
    }, [ws.id]);

    return (
        <div className="p-4 flex flex-col gap-4">
            {/* Metadata grid */}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <MetaRow label="Path" value={ws.rootPath || ''} mono />
                <MetaRow label="Branch" value={branch + dirty} />
                <MetaRow label="Sync" value={syncLabel} />
                {remoteUrl && <MetaRow label="Remote" value={remoteUrl} mono />}
                <MetaRow label="Color">
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 rounded-full" style={{ background: color }} />
                        {color}
                    </span>
                </MetaRow>
                <MetaRow label="Pipelines" value={String(repo.pipelines?.length || 0)} />
                <MetaRow label="Tasks" value={String(repo.taskCount || 0)} />
                <MetaRow label="Completed" value={String(stats.success)} />
                <MetaRow label="Failed" value={String(stats.failed)} />
                <MetaRow label="Running" value={String(stats.running)} />
            </div>

            {/* Recent processes */}
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Recent Processes</h3>
                {loadingProcesses ? (
                    <div className="text-xs text-[#848484]">Loading...</div>
                ) : processes.length === 0 ? (
                    <div className="text-xs text-[#848484]">No processes yet</div>
                ) : (
                    <div className="flex flex-col gap-0.5">
                        {processes.map(p => {
                            const icon = STATUS_ICON[p.status] || '•';
                            const title = p.promptPreview || p.id || 'Untitled';
                            const display = title.length > 50 ? title.substring(0, 50) + '...' : title;
                            const time = p.startTime ? formatRelativeTime(p.startTime) : '';
                            return (
                                <div key={p.id} className="flex items-center gap-2 py-1 text-xs">
                                    <span>{icon}</span>
                                    <span className="flex-1 truncate text-[#1e1e1e] dark:text-[#cccccc]">{display}</span>
                                    <span className="text-[#848484] text-[11px] flex-shrink-0">{time}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function MetaRow({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
    return (
        <>
            <span className="text-[#848484] text-xs font-medium">{label}</span>
            {children ?? (
                <span className={`text-[#1e1e1e] dark:text-[#cccccc] text-xs ${mono ? 'font-mono break-all' : ''}`}>
                    {value}
                </span>
            )}
        </>
    );
}
