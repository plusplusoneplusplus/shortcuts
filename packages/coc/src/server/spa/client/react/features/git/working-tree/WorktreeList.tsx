/**
 * WorktreeList — repo-scoped list of CoC-created Git worktrees (AC-06).
 *
 * A small collapsible section under the Git tab's local-tree actions that lists
 * the worktrees CoC created for the selected workspace, with a Cleanup action on
 * each still-active record. Strictly workspace-scoped: it fetches only the
 * selected clone's worktrees (via `useCocClient`), so records never mix across
 * workspaces or remote targets.
 *
 * Cleanup removes the checkout (`git worktree remove`, never `--force`) and keeps
 * the branch. The server refuses cleanup while a linked task/session is running
 * or when Git refuses removal (e.g. a dirty worktree) — those come back as a 409
 * and are surfaced inline on the row while the record stays active. Rendered only
 * when the `gitWorktreeExecution` feature flag is on; renders nothing when the
 * workspace has no CoC-created worktrees.
 */
import { useCallback, useEffect, useState } from 'react';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { isGitWorktreeExecutionEnabled } from '../../../utils/config';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { WorktreeChip } from '../../../shared/WorktreeChip';
import { useWorktreeCleanup } from '../../../shared/useWorktreeCleanup';

interface WorktreeListProps {
    workspaceId: string;
    /** Increment to trigger a re-fetch (wired to the Git tab refresh). */
    refreshKey?: number;
    /** Dense split-workspace skin to match the surrounding working-tree card. */
    compact?: boolean;
}

/** Short, human-facing label for the run a worktree is linked to. */
function linkedRunLabel(record: WorktreeMetadata): string | null {
    if (record.ralphSessionId) return `Ralph session ${record.ralphSessionId}`;
    if (record.processId) return `Task ${record.processId}`;
    return null;
}

export function WorktreeList({ workspaceId, refreshKey, compact }: WorktreeListProps) {
    const available = isGitWorktreeExecutionEnabled();
    const cocClient = useCocClient(workspaceId);
    const [records, setRecords] = useState<WorktreeMetadata[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const { cleanup, cleaningId, errors } = useWorktreeCleanup(workspaceId);

    const fetchList = useCallback(() => {
        return cocClient.git
            .listWorktrees(workspaceId)
            .then(data => {
                setRecords(data.worktrees ?? []);
                setError(null);
            })
            .catch(err => setError(getSpaCocClientErrorMessage(err, 'Failed to load worktrees')));
    }, [cocClient, workspaceId]);

    useEffect(() => {
        if (!available) return;
        // Reset on workspace switch so one clone's records never flash for another.
        setLoaded(false);
        setRecords([]);
        fetchList().finally(() => setLoaded(true));
    }, [available, workspaceId, fetchList, refreshKey]);

    const handleCleanup = useCallback(
        async (id: string) => {
            const result = await cleanup(id);
            // On success replace the record with the cleaned one (status → cleaned).
            // On failure/refusal the error is surfaced on the chip and the record
            // stays active (no local mutation).
            if (result) {
                setRecords(prev => prev.map(r => (r.id === id ? result.worktree : r)));
            }
        },
        [cleanup],
    );

    // Flag off, still loading, or nothing to show → render nothing (keeps the
    // Git tab uncluttered when the feature is unused for this workspace).
    if (!available || !loaded) return null;
    if (records.length === 0 && !error) return null;

    const activeCount = records.filter(r => r.status === 'active').length;

    return (
        <section
            className={compact
                ? 'worktree-list border-l-[3px] border-l-[#8250df] dark:border-l-[#a371f7] bg-white dark:bg-[#1e1e1e] overflow-hidden'
                : 'worktree-list rounded-md border border-[#8250df]/30 dark:border-[#a371f7]/35 border-l-[3px] border-l-[#8250df] dark:border-l-[#a371f7] bg-white dark:bg-[#1e1e1e] overflow-hidden'}
            data-testid="worktree-list"
            aria-label="CoC Git worktrees"
        >
            <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                className={`w-full flex items-center text-left cursor-pointer transition-colors bg-[#8250df]/[0.05] dark:bg-[#a371f7]/[0.08] hover:bg-[#8250df]/[0.09] dark:hover:bg-[#a371f7]/[0.14] ${compact ? 'gap-1.5 px-1.5 py-0.5' : 'gap-2 px-2.5 py-1'}`}
                onClick={() => setExpanded(prev => !prev)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(prev => !prev); } }}
                data-testid="worktree-list-header"
            >
                <span className="text-[10px] text-[#848484] dark:text-[#9d9d9d] flex-shrink-0 w-3 text-center">{expanded ? '▼' : '▶'}</span>
                <span className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span
                        className="inline-flex items-center gap-1 px-1.5 py-px rounded-full font-mono font-semibold uppercase tracking-[0.06em] text-[9px] leading-[1.4] text-[#8250df] dark:text-[#a371f7] bg-[#8250df]/10 dark:bg-[#a371f7]/15 border border-[#8250df]/30 dark:border-[#a371f7]/35 whitespace-nowrap flex-shrink-0"
                        data-testid="worktree-list-badge"
                    >
                        <span aria-hidden="true">🌳</span> Worktrees
                    </span>
                    <span
                        className="text-[10.5px] text-[#616161] dark:text-[#999] truncate min-w-0"
                        data-testid="worktree-list-summary"
                    >
                        {activeCount} active · {records.length} total
                    </span>
                </span>
            </div>

            {expanded && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-2.5 py-2 space-y-2" data-testid="worktree-list-content">
                    {error && (
                        <div className="text-[11px] text-[#cf222e] dark:text-[#f85149]" data-testid="worktree-list-error">
                            {error}
                        </div>
                    )}
                    {records.map((record, i) => {
                        const linked = linkedRunLabel(record);
                        return (
                            <div key={record.id} className="space-y-0.5" data-testid={`worktree-list-row-${i}`}>
                                <WorktreeChip
                                    worktree={record}
                                    testId={`worktree-list-chip-${i}`}
                                    onCleanup={() => handleCleanup(record.id)}
                                    cleaningUp={cleaningId === record.id}
                                    cleanupError={errors[record.id]}
                                />
                                {linked && (
                                    <div className="pl-1 text-[10.5px] text-[#848484]" data-testid={`worktree-list-linked-${i}`}>
                                        {linked}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
