/**
 * WorkingTreeAllFilesDiff — every working-tree change in one scroll.
 *
 * The working-tree counterpart of BranchAllFilesDiff: staged, unstaged and
 * untracked files grouped by section. Rows start collapsed; expanding one
 * lazy-fetches that file's diff (an untracked file's content is shown as an
 * all-added diff). "Open →" goes to the single-file working-tree view.
 */

import { useState, useEffect, useCallback } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { Spinner, TruncatedPath } from '../../../ui';
import { UnifiedDiffViewer } from '../diff/UnifiedDiffViewer';
import { STATUS_COLORS, STATUS_LABELS, normalizeStatus } from '../diff/FileTree';
import { hasMultipleRepos, relDisplayPath } from './WorkingTree';
import type { WorkingTreeChange } from './WorkingTree';

type Stage = WorkingTreeChange['stage'];

type FileState = {
    expanded: boolean;
    diff: string | null;
    loading: boolean;
    error: string | null;
};

const COLLAPSED: FileState = { expanded: false, diff: null, loading: false, error: null };

const DIFF_LINE_LIMIT = 200;

const SECTIONS: { stage: Stage; title: string }[] = [
    { stage: 'staged', title: 'Staged' },
    { stage: 'unstaged', title: 'Changes' },
    { stage: 'untracked', title: 'Untracked' },
];

export interface WorkingTreeAllFilesDiffProps {
    workspaceId: string;
    onFileSelect: (filePath: string, stage: Stage) => void;
    /** Bumped by every working-tree refresh; re-reads the list and drops cached diffs. */
    refreshKey?: number;
}

/** A partially staged path appears in two sections, so the stage is part of the key. */
function rowKey(change: WorkingTreeChange): string {
    return `${change.stage}:${change.filePath}`;
}

/** Show an untracked file as a diff that adds every line. */
export function untrackedContentAsDiff(content: string): string {
    if (content === '') return '';
    const lines = content.replace(/\n$/, '').split('\n');
    return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)].join('\n');
}

export function WorkingTreeAllFilesDiff({ workspaceId, onFileSelect, refreshKey }: WorkingTreeAllFilesDiffProps) {
    const cloneClient = useCocClient(workspaceId);
    const [changes, setChanges] = useState<WorkingTreeChange[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fileStates, setFileStates] = useState<Record<string, FileState>>({});

    useEffect(() => {
        let cancelled = false;
        setError(null);
        cloneClient.git.getWorkingTreeChanges(workspaceId)
            .then(data => {
                if (cancelled) return;
                setChanges(data.changes ?? []);
                // The files changed on disk; cached diffs are stale.
                setFileStates({});
            })
            .catch(err => { if (!cancelled) setError(err.message || 'Failed to load changes'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [workspaceId, cloneClient, refreshKey]);

    const loadDiff = useCallback(async (change: WorkingTreeChange): Promise<string> => {
        if (change.stage === 'untracked') {
            const content = await cloneClient.git.getWorkingTreeFileContent(workspaceId, change.filePath, 'untracked');
            if (content.binary) throw new Error('Binary file — open it to preview');
            if (content.tooLarge) throw new Error('File too large to show inline — open it to preview');
            return untrackedContentAsDiff(content.head.content ?? '');
        }
        const data = await cloneClient.git.getWorkingTreeFileDiff(workspaceId, change.filePath, { stage: change.stage });
        return data.diff ?? '';
    }, [cloneClient, workspaceId]);

    const toggleFile = (change: WorkingTreeChange) => {
        const key = rowKey(change);
        const current = fileStates[key] ?? COLLAPSED;
        if (current.expanded || current.diff !== null || current.loading) {
            setFileStates(prev => ({ ...prev, [key]: { ...current, expanded: !current.expanded } }));
            return;
        }
        setFileStates(prev => ({ ...prev, [key]: { expanded: true, diff: null, loading: true, error: null } }));
        loadDiff(change)
            .then(diff => setFileStates(prev => ({ ...prev, [key]: { expanded: true, diff, loading: false, error: null } })))
            .catch(err => setFileStates(prev => ({
                ...prev,
                [key]: { expanded: true, diff: null, loading: false, error: err.message || 'Failed to load diff' },
            })));
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-[#848484]" data-testid="working-tree-all-files-loading">
                <Spinner size="sm" /> Loading changes...
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-4 py-6 text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="working-tree-all-files-error">
                {error}
            </div>
        );
    }

    const multiRepo = hasMultipleRepos(changes);

    return (
        <div className="flex flex-col h-full min-h-0" data-testid="working-tree-all-files">
            <div className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc]">
                All Working Changes
                <span className="ml-2 text-xs font-normal text-[#848484]">{changes.length} files</span>
            </div>
            {changes.length === 0 ? (
                <div className="px-4 py-6 text-xs text-[#848484] italic text-center" data-testid="working-tree-all-files-empty">
                    No working-tree changes
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {SECTIONS.map(({ stage, title }) => {
                        const sectionChanges = changes.filter(c => c.stage === stage);
                        if (sectionChanges.length === 0) return null;
                        return (
                            <div key={stage} data-testid={`working-tree-all-section-${stage}`}>
                                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#616161] dark:text-[#999] bg-[#f5f5f5] dark:bg-[#252526] border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                                    {title} ({sectionChanges.length})
                                </div>
                                {sectionChanges.map(change => (
                                    <FileRow
                                        key={rowKey(change)}
                                        change={change}
                                        displayPath={relDisplayPath(change, multiRepo)}
                                        state={fileStates[rowKey(change)] ?? COLLAPSED}
                                        onToggle={() => toggleFile(change)}
                                        onOpen={() => onFileSelect(change.filePath, change.stage)}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function FileRow({ change, displayPath, state, onToggle, onOpen }: {
    change: WorkingTreeChange;
    displayPath: string;
    state: FileState;
    onToggle: () => void;
    onOpen: () => void;
}) {
    const testKey = `${change.stage}-${displayPath}`;
    const status = normalizeStatus(change.status);
    const lines = state.diff ? state.diff.split('\n') : [];
    const isTruncated = lines.length > DIFF_LINE_LIMIT;
    return (
        <div className="border-b border-[#e0e0e0] dark:border-[#3c3c3c] last:border-b-0" data-file-path={change.filePath}>
            <div className="flex items-center gap-2 px-4 py-1.5 hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e] transition-colors">
                <button
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    onClick={onToggle}
                    aria-expanded={state.expanded}
                    data-testid={`working-tree-all-file-toggle-${testKey}`}
                >
                    <span className="text-[10px] text-[#848484] flex-shrink-0">{state.expanded ? '▼' : '▶'}</span>
                    <span
                        className={`font-mono font-bold text-xs w-4 text-center flex-shrink-0 ${STATUS_COLORS[status] || 'text-[#848484]'}`}
                        title={STATUS_LABELS[status] || change.status}
                    >
                        {status}
                    </span>
                    <TruncatedPath path={displayPath} className="text-xs text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                    {change.additions !== undefined && <span className="text-[#16825d] text-xs flex-shrink-0">+{change.additions}</span>}
                    {change.deletions !== undefined && <span className="text-[#d32f2f] text-xs flex-shrink-0">−{change.deletions}</span>}
                </button>
                <button
                    className="text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:underline flex-shrink-0 ml-1"
                    onClick={onOpen}
                    title="Open full diff"
                    data-testid={`working-tree-all-file-open-${testKey}`}
                >
                    Open →
                </button>
            </div>
            {state.expanded && (
                <div className="pl-8 pr-4 pb-2" data-testid={`working-tree-all-file-diff-${testKey}`}>
                    {state.loading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484] py-1">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : state.error ? (
                        <div className="text-xs text-[#d32f2f] dark:text-[#f48771] py-1">{state.error}</div>
                    ) : state.diff === '' ? (
                        <div className="text-xs text-[#848484] italic py-1">(empty diff)</div>
                    ) : (
                        <>
                            <div className="max-h-[400px] overflow-y-auto rounded">
                                <UnifiedDiffViewer
                                    diff={(isTruncated ? lines.slice(0, DIFF_LINE_LIMIT) : lines).join('\n')}
                                    fileName={displayPath}
                                    enableComments={false}
                                    showLineNumbers={false}
                                />
                            </div>
                            {isTruncated && (
                                <button
                                    className="mt-1 text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                                    onClick={onOpen}
                                    data-testid={`working-tree-all-file-show-full-${testKey}`}
                                >
                                    Showing first {DIFF_LINE_LIMIT} lines — Show full diff →
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
