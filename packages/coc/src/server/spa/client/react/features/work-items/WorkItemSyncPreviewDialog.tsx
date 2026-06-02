import type {
    WorkItemSyncApplyResponse,
    WorkItemSyncConflict,
    WorkItemSyncConflictResolution,
    WorkItemSyncFieldChange,
    WorkItemSyncOperation,
    WorkItemSyncPreviewOperation,
    WorkItemSyncPreviewResponse,
    WorkItemSyncWarning,
} from '@plusplusoneplusplus/coc-client';
import { Button, Dialog, cn } from '../../ui';

export type WorkItemSyncPreviewPhase = 'previewing' | 'ready' | 'applying' | 'success' | 'error';

export interface WorkItemSyncPreviewDialogState {
    operation: WorkItemSyncOperation;
    phase: WorkItemSyncPreviewPhase;
    preview?: WorkItemSyncPreviewResponse;
    applyResult?: WorkItemSyncApplyResponse;
    error?: string | null;
    conflictResolutions: Record<string, WorkItemSyncConflictResolution>;
}

interface WorkItemSyncPreviewDialogProps {
    state: WorkItemSyncPreviewDialogState;
    onClose: () => void;
    onApply: () => void;
    onConflictResolutionChange: (conflictId: string, resolution: WorkItemSyncConflictResolution) => void;
}

const OPERATION_LABELS: Record<WorkItemSyncOperation, string> = {
    import: 'Import',
    'export-selected': 'Export selected',
    'sync-linked': 'Sync linked',
};

const RESOLUTION_LABELS: Record<WorkItemSyncConflictResolution, string> = {
    'use-coc': 'Use CoC',
    'use-provider': 'Use GitHub',
    skip: 'Skip',
};

function describeValue(value: unknown): string {
    if (value === undefined) return '-';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function describeRemote(op: WorkItemSyncPreviewOperation | WorkItemSyncWarning | WorkItemSyncConflict): string | undefined {
    const remote = op.remote;
    if (!remote) return undefined;
    if (remote.owner && remote.repo && remote.issueNumber) return `${remote.owner}/${remote.repo}#${remote.issueNumber}`;
    if (remote.issueNumber) return `#${remote.issueNumber}`;
    return remote.issueUrl ?? remote.issueId;
}

function FieldList({ fields }: { fields?: WorkItemSyncFieldChange[] }) {
    if (!fields?.length) return null;
    return (
        <ul className="mt-1 grid gap-1 text-[11px] text-[#656d76] dark:text-[#999]">
            {fields.map((field, index) => (
                <li key={`${field.field}-${index}`} className="grid gap-0.5">
                    <span className="font-medium text-[#57606a] dark:text-[#adbac7]">{field.field}</span>
                    <span className="font-mono break-all">
                        {describeValue(field.cocValue)} {'->'} {describeValue(field.proposedValue ?? field.remoteValue)}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function OperationGroup({ title, operations, testId }: { title: string; operations: WorkItemSyncPreviewOperation[]; testId: string }) {
    return (
        <section className="rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] overflow-hidden" data-testid={testId}>
            <div className="px-3 py-2 bg-[#f6f8fa] dark:bg-[#252526] border-b border-[#d0d7de] dark:border-[#3c3c3c] flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#1f2328] dark:text-[#cccccc]">{title}</h3>
                <span className="text-[11px] text-[#656d76] dark:text-[#999]">{operations.length}</span>
            </div>
            {operations.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[#848484]">No rows.</p>
            ) : (
                <div className="divide-y divide-[#eaeef2] dark:divide-[#3c3c3c]">
                    {operations.map(op => (
                        <div key={op.id} className="px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[10px] rounded-full border border-[#d0d7de] dark:border-[#555] px-1.5 py-px text-[#656d76] dark:text-[#999]">
                                    {op.kind}
                                </span>
                                <strong className="text-xs text-[#1f2328] dark:text-[#cccccc] truncate">{op.title}</strong>
                            </div>
                            <div className="mt-0.5 text-[11px] text-[#656d76] dark:text-[#999]">
                                {op.itemType && <span>{op.itemType}</span>}
                                {op.status && <span> · {op.status}</span>}
                                {describeRemote(op) && <span> · {describeRemote(op)}</span>}
                            </div>
                            <FieldList fields={op.fields} />
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function WarningsGroup({ warnings }: { warnings: WorkItemSyncWarning[] }) {
    return (
        <section className="rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden" data-testid="hierarchy-sync-preview-warnings">
            <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300">Warnings</h3>
                <span className="text-[11px] text-amber-700 dark:text-amber-300">{warnings.length}</span>
            </div>
            {warnings.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[#848484]">No warnings.</p>
            ) : (
                <div className="divide-y divide-amber-100 dark:divide-amber-900/40">
                    {warnings.map(warning => (
                        <div key={warning.id} className="px-3 py-2 text-xs text-[#1f2328] dark:text-[#cccccc]">
                            {warning.message}
                            {describeRemote(warning) && <span className="ml-1 text-[#656d76] dark:text-[#999]">{describeRemote(warning)}</span>}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function ConflictsGroup({
    conflicts,
    resolutions,
    onResolutionChange,
}: {
    conflicts: WorkItemSyncConflict[];
    resolutions: Record<string, WorkItemSyncConflictResolution>;
    onResolutionChange: (conflictId: string, resolution: WorkItemSyncConflictResolution) => void;
}) {
    return (
        <section className="rounded-md border border-red-200 dark:border-red-800 overflow-hidden" data-testid="hierarchy-sync-preview-conflicts">
            <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-red-700 dark:text-red-300">Conflicts</h3>
                <span className="text-[11px] text-red-700 dark:text-red-300">{conflicts.length}</span>
            </div>
            {conflicts.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[#848484]">No conflicts.</p>
            ) : (
                <div className="divide-y divide-red-100 dark:divide-red-900/40">
                    {conflicts.map(conflict => (
                        <div key={conflict.id} className="px-3 py-2 grid gap-2">
                            <div>
                                <p className="text-xs font-medium text-[#1f2328] dark:text-[#cccccc]">{conflict.message}</p>
                                {describeRemote(conflict) && <p className="text-[11px] text-[#656d76] dark:text-[#999]">{describeRemote(conflict)}</p>}
                            </div>
                            <FieldList fields={conflict.fields} />
                            <label className="grid gap-1 text-[11px] text-[#656d76] dark:text-[#999]">
                                Resolution
                                <select
                                    value={resolutions[conflict.id] ?? ''}
                                    onChange={event => onResolutionChange(conflict.id, event.target.value as WorkItemSyncConflictResolution)}
                                    className="w-full rounded border border-[#d0d7de] dark:border-[#555] bg-white dark:bg-[#1e1e1e] px-2 py-1 text-xs text-[#1f2328] dark:text-[#cccccc]"
                                    data-testid={`hierarchy-sync-conflict-resolution-${conflict.id}`}
                                >
                                    <option value="">Choose resolution...</option>
                                    {conflict.allowedResolutions.map(resolution => (
                                        <option key={resolution} value={resolution}>{RESOLUTION_LABELS[resolution]}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function ApplyResult({ result }: { result: WorkItemSyncApplyResponse }) {
    return (
        <section className="rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] overflow-hidden" data-testid="hierarchy-sync-apply-result">
            <div className="px-3 py-2 bg-[#f6f8fa] dark:bg-[#252526] border-b border-[#d0d7de] dark:border-[#3c3c3c]">
                <h3 className="text-xs font-semibold text-[#1f2328] dark:text-[#cccccc]">
                    Applied {result.applied}, skipped {result.skipped}, failed {result.failed}
                </h3>
            </div>
            <div className="divide-y divide-[#eaeef2] dark:divide-[#3c3c3c]">
                {result.rows.map(row => (
                    <div key={row.id} className="px-3 py-2 text-xs" data-testid="hierarchy-sync-apply-row">
                        <span className={cn(
                            'inline-flex rounded-full px-1.5 py-px mr-2 text-[10px]',
                            row.status === 'failed'
                                ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                                : row.status === 'skipped'
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                                    : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300',
                        )}>
                            {row.status}
                        </span>
                        <span className="text-[#1f2328] dark:text-[#cccccc]">{row.message ?? row.operationId ?? row.workItemId ?? row.id}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

export function hasUnresolvedSyncConflicts(state: WorkItemSyncPreviewDialogState): boolean {
    return (state.preview?.conflicts ?? []).some(conflict => state.conflictResolutions[conflict.id] === undefined);
}

export function WorkItemSyncPreviewDialog({
    state,
    onClose,
    onApply,
    onConflictResolutionChange,
}: WorkItemSyncPreviewDialogProps) {
    const preview = state.preview;
    const unresolvedConflicts = preview?.conflicts.filter(conflict => state.conflictResolutions[conflict.id] === undefined).length ?? 0;
    const canApply = state.phase === 'ready' && !!preview && unresolvedConflicts === 0;

    return (
        <Dialog
            open={true}
            onClose={state.phase === 'applying' ? () => undefined : onClose}
            title={`GitHub ${OPERATION_LABELS[state.operation]} preview`}
            className="max-w-[820px]"
            id="hierarchy-sync-preview-dialog"
            disableClose={state.phase === 'applying'}
            footer={(
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={state.phase === 'applying'} data-testid="hierarchy-sync-close-btn">
                        {state.phase === 'success' ? 'Done' : 'Close'}
                    </Button>
                    {state.phase !== 'success' && (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={onApply}
                            disabled={!canApply}
                            loading={state.phase === 'applying'}
                            data-testid="hierarchy-sync-apply-btn"
                            title={unresolvedConflicts > 0 ? 'Resolve every conflict before applying' : undefined}
                        >
                            Apply preview
                        </Button>
                    )}
                </>
            )}
        >
            <div className="grid gap-3" data-testid="hierarchy-sync-preview-dialog">
                {state.phase === 'previewing' && (
                    <div className="rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] p-4 text-sm text-[#656d76] dark:text-[#999]" data-testid="hierarchy-sync-preview-loading">
                        Loading preview...
                    </div>
                )}
                {state.error && (
                    <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300" data-testid="hierarchy-sync-preview-error">
                        {state.error}
                    </div>
                )}
                {preview && (
                    <>
                        <div className="rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526] p-3 text-xs text-[#57606a] dark:text-[#adbac7]" data-testid="hierarchy-sync-preview-summary">
                            {preview.itemCount} item{preview.itemCount === 1 ? '' : 's'} in preview. Limit {preview.maxItems}.
                            {unresolvedConflicts > 0 && (
                                <span className="ml-2 text-red-600 dark:text-red-300">
                                    Resolve {unresolvedConflicts} conflict{unresolvedConflicts === 1 ? '' : 's'} before applying.
                                </span>
                            )}
                        </div>
                        <OperationGroup title="Creates" operations={preview.creates} testId="hierarchy-sync-preview-creates" />
                        <OperationGroup title="Updates" operations={preview.updates} testId="hierarchy-sync-preview-updates" />
                        <OperationGroup title="Links" operations={preview.links} testId="hierarchy-sync-preview-links" />
                        <ConflictsGroup
                            conflicts={preview.conflicts}
                            resolutions={state.conflictResolutions}
                            onResolutionChange={onConflictResolutionChange}
                        />
                        <WarningsGroup warnings={preview.warnings} />
                        <OperationGroup title="No-ops" operations={preview.noOps} testId="hierarchy-sync-preview-noops" />
                    </>
                )}
                {state.applyResult && <ApplyResult result={state.applyResult} />}
            </div>
        </Dialog>
    );
}
