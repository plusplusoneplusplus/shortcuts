import { useEffect, useMemo, useState } from 'react';
import type { ForEachChildMode, ForEachItem, ForEachRun } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import type { ResolvedModalJobAiSelection } from './ModalJobAiControls';

export interface ForEachLaunchDialogProps {
    open: boolean;
    workspaceId: string;
    request: string;
    resolvedAiSelection: ResolvedModalJobAiSelection;
    attachmentCount?: number;
    onClose: () => void;
    onApproved: (run: ForEachRun) => void | Promise<void>;
}

function formatItems(items: ForEachItem[]): string {
    return JSON.stringify(items, null, 2);
}

function parseItems(text: string): ForEachItem[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Item plan must be valid JSON: ${message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error('Item plan JSON must be an array of items.');
    }
    return parsed as ForEachItem[];
}

function buildConfig(selection: ResolvedModalJobAiSelection): { model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' } | undefined {
    const config: { model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' } = {};
    if (selection.model) config.model = selection.model;
    if (
        selection.reasoningEffort === 'low'
        || selection.reasoningEffort === 'medium'
        || selection.reasoningEffort === 'high'
        || selection.reasoningEffort === 'xhigh'
    ) {
        config.reasoningEffort = selection.reasoningEffort;
    }
    return Object.keys(config).length > 0 ? config : undefined;
}

function statusSummary(run: ForEachRun | null): string {
    if (!run) return 'No item plan generated yet.';
    const counts = new Map<string, number>();
    for (const item of run.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return Array.from(counts.entries()).map(([status, count]) => `${count} ${status}`).join(' - ');
}

export function ForEachLaunchDialog({
    open,
    workspaceId,
    request,
    resolvedAiSelection,
    attachmentCount = 0,
    onClose,
    onApproved,
}: ForEachLaunchDialogProps) {
    const [draftRequest, setDraftRequest] = useState(request);
    const [sharedInstructions, setSharedInstructions] = useState('');
    const [childMode, setChildMode] = useState<ForEachChildMode>('ask');
    const [run, setRun] = useState<ForEachRun | null>(null);
    const [itemsJson, setItemsJson] = useState('');
    const [busy, setBusy] = useState<'idle' | 'generating' | 'approving'>('idle');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setDraftRequest(request);
        setSharedInstructions('');
        setChildMode('ask');
        setRun(null);
        setItemsJson('');
        setBusy('idle');
        setError(null);
    }, [open, request]);

    const trimmedRequest = draftRequest.trim();
    const trimmedSharedInstructions = sharedInstructions.trim();
    const attachmentsBlocked = attachmentCount > 0;
    const aiSummary = useMemo(() => {
        return [
            resolvedAiSelection.provider,
            `model: ${resolvedAiSelection.model ?? 'workspace default'}`,
            `effort: ${resolvedAiSelection.reasoningEffort ?? 'auto'}`,
        ].join(' - ');
    }, [resolvedAiSelection]);

    if (!open) return null;

    async function handleGenerate() {
        if (!trimmedRequest) {
            setError('Enter the For Each request before generating an item plan.');
            return;
        }
        if (attachmentsBlocked) {
            setError(`Remove ${attachmentCount} file attachment${attachmentCount === 1 ? '' : 's'} before generating a For Each item plan.`);
            return;
        }
        setBusy('generating');
        setError(null);
        try {
            const generated = await getSpaCocClient().forEach.generate(workspaceId, {
                prompt: trimmedRequest,
                sharedInstructions: trimmedSharedInstructions || undefined,
                childMode,
                provider: resolvedAiSelection.provider,
                config: buildConfig(resolvedAiSelection),
            });
            setRun(generated);
            setSharedInstructions(generated.sharedInstructions ?? trimmedSharedInstructions);
            setChildMode(generated.childMode);
            setItemsJson(formatItems(generated.items));
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to generate For Each item plan'));
        } finally {
            setBusy('idle');
        }
    }

    async function handleApprove() {
        if (!run) return;
        let items: ForEachItem[];
        try {
            items = parseItems(itemsJson);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return;
        }

        setBusy('approving');
        setError(null);
        try {
            await getSpaCocClient().forEach.updatePlan(workspaceId, run.runId, {
                items,
                sharedInstructions,
                childMode,
            });
            const approved = await getSpaCocClient().forEach.approve(workspaceId, run.runId);
            setRun(approved);
            setItemsJson(formatItems(approved.items));
            await onApproved(approved);
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to approve For Each item plan'));
        } finally {
            setBusy('idle');
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="for-each-launch-dialog"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="mx-4 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#e0e0e0] bg-white shadow-xl dark:border-[#3c3c3c] dark:bg-[#252526]">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] px-4 py-3 dark:border-[#3c3c3c]">
                    <div>
                        <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">For Each item plan</h2>
                        <p className="mt-0.5 text-xs text-[#848484]">Generate a reviewed list before any child chat is queued.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-sm text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                        aria-label="Close"
                    >
                        x
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <section className="space-y-3">
                            <div>
                                <label className="mb-1 block text-xs text-[#848484]" htmlFor="for-each-request-input">
                                    Original request
                                </label>
                                <textarea
                                    id="for-each-request-input"
                                    data-testid="for-each-request-input"
                                    value={draftRequest}
                                    rows={7}
                                    disabled={busy !== 'idle'}
                                    onChange={(e) => {
                                        setDraftRequest(e.target.value);
                                        if (error) setError(null);
                                    }}
                                    className="w-full resize-y rounded border border-[#d0d0d0] bg-white p-2 text-xs text-[#1e1e1e] dark:border-[#4a4a4a] dark:bg-[#1a1a1a] dark:text-[#cccccc]"
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-xs text-[#848484]" htmlFor="for-each-shared-instructions">
                                    Shared instructions (optional)
                                </label>
                                <textarea
                                    id="for-each-shared-instructions"
                                    data-testid="for-each-shared-instructions"
                                    value={sharedInstructions}
                                    rows={4}
                                    disabled={busy !== 'idle'}
                                    onChange={(e) => setSharedInstructions(e.target.value)}
                                    placeholder="Instructions included with every child item prompt..."
                                    className="w-full resize-y rounded border border-[#d0d0d0] bg-white p-2 text-xs text-[#1e1e1e] placeholder:text-[#999] dark:border-[#4a4a4a] dark:bg-[#1a1a1a] dark:text-[#cccccc]"
                                />
                            </div>

                            <div>
                                <div className="mb-1 text-xs text-[#848484]">Child mode</div>
                                <div className="inline-flex rounded-md border border-[#d0d0d0] p-px dark:border-[#3c3c3c]" data-testid="for-each-child-mode-selector">
                                    {(['ask', 'autopilot'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            type="button"
                                            disabled={busy !== 'idle'}
                                            onClick={() => setChildMode(mode)}
                                            data-testid={`for-each-child-mode-${mode}`}
                                            data-selected={childMode === mode ? 'true' : 'false'}
                                            className={
                                                'rounded px-2 py-1 text-xs font-medium transition-colors ' +
                                                (childMode === mode
                                                    ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100'
                                                    : 'text-[#5a5a5a] hover:bg-[#f3f3f3] dark:text-[#cccccc] dark:hover:bg-[#2a2a2a]')
                                            }
                                        >
                                            {mode === 'ask' ? 'Ask' : 'Autopilot'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded border border-[#d0d0d0] bg-[#f8f8f8] px-2 py-1 text-xs text-[#5a5a5a] dark:border-[#3c3c3c] dark:bg-[#1f1f1f] dark:text-[#cccccc]" data-testid="for-each-ai-summary">
                                {aiSummary}
                            </div>

                            {attachmentsBlocked && (
                                <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="for-each-attachment-warning">
                                    For Each v1 sends request text only. Remove {attachmentCount} file attachment{attachmentCount === 1 ? '' : 's'} before generating.
                                </p>
                            )}
                        </section>

                        <section className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#5a5a5a] dark:text-[#cccccc]">Generated item plan</h3>
                                    <p className="text-[11px] text-[#848484]" data-testid="for-each-plan-summary">{statusSummary(run)}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleGenerate}
                                    disabled={busy !== 'idle' || !trimmedRequest || attachmentsBlocked}
                                    className="rounded border border-sky-500 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-200"
                                    data-testid="for-each-generate-btn"
                                >
                                    {busy === 'generating' ? 'Generating...' : run ? 'Regenerate' : 'Generate'}
                                </button>
                            </div>

                            {run ? (
                                <>
                                    <div className="max-h-36 overflow-y-auto rounded border border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="for-each-generated-items">
                                        {run.items.map(item => (
                                            <div key={item.id} className="border-b border-[#e0e0e0] px-2 py-1.5 last:border-b-0 dark:border-[#3c3c3c]">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="truncate text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">{item.title}</span>
                                                    <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] uppercase text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">{item.status}</span>
                                                </div>
                                                <p className="mt-0.5 line-clamp-2 text-[11px] text-[#5a5a5a] dark:text-[#aaaaaa]">{item.prompt}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <textarea
                                        value={itemsJson}
                                        onChange={(e) => {
                                            setItemsJson(e.target.value);
                                            if (error) setError(null);
                                        }}
                                        disabled={busy !== 'idle'}
                                        rows={10}
                                        data-testid="for-each-items-json"
                                        className="w-full resize-y rounded border border-[#d0d0d0] bg-white p-2 font-mono text-xs text-[#1e1e1e] dark:border-[#4a4a4a] dark:bg-[#1a1a1a] dark:text-[#cccccc]"
                                    />
                                    <p className="text-[10px] text-[#848484]">
                                        Edit the JSON array before approval. Items must keep id, title, prompt, and initial pending status.
                                    </p>
                                </>
                            ) : (
                                <div className="flex min-h-64 items-center justify-center rounded border border-dashed border-[#d0d0d0] p-4 text-center text-xs text-[#848484] dark:border-[#3c3c3c]">
                                    Generate a structured item plan to review and edit it here.
                                </div>
                            )}
                        </section>
                    </div>

                    {error && (
                        <p className="mt-3 text-xs text-[#f14c4c]" data-testid="for-each-launch-error">
                            {error}
                        </p>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-[#e0e0e0] px-4 py-3 dark:border-[#3c3c3c]">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy !== 'idle'}
                        className="px-3 py-1.5 text-sm text-[#5a5a5a] hover:text-[#1e1e1e] disabled:opacity-50 dark:text-[#999] dark:hover:text-[#ccc]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleApprove}
                        disabled={busy !== 'idle' || !run}
                        data-testid="for-each-approve-btn"
                        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-400"
                    >
                        {busy === 'approving' ? 'Approving...' : 'Approve run'}
                    </button>
                </div>
            </div>
        </div>
    );
}
