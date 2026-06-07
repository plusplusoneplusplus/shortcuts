/**
 * RalphWorkflowPane — right-pane visualization of a Ralph session journal.
 *
 * Renders the iteration timeline alongside the raw session file browser. Data
 * fetching and URL routing stay in the container/router layers.
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { cn } from '../../ui/cn';
import { formatRelativeTime } from '../../utils/format';
import { MarkdownView } from '../../shared/MarkdownView';
import { renderMarkdownToHtml } from '../../../diff/markdown-renderer';
import type {
    ParsedProgressSection,
    RalphContinueRequest,
    RalphResumeAiDefaults,
    RalphResumeRequest,
    RalphLoopRecord,
    RalphSessionFile,
    RalphSessionRecord,
    RalphTerminalReason,
} from '@plusplusoneplusplus/coc-client';
import { RalphWorkflowNode } from './RalphWorkflowNode';
import { getSpaCocClient } from '../../api/cocClient';
import { RALPH_MULTI_LOOP } from '../../featureFlags';
import { ModalJobAiControls, type ResolvedModalJobAiSelection, useModalJobAiSelection } from '../../shared/ModalJobAiControls';

/** Combined view fetched from the server. */
export interface RalphSessionView {
    record: RalphSessionRecord;
    sections: ParsedProgressSection[];
    files?: RalphSessionFile[];
    resumeDefaults?: RalphResumeAiDefaults;
}

export interface RalphWorkflowPaneProps {
    workspaceId: string;
    sessionId: string;
    /** When undefined the pane shows a loading state. When `null` an empty
     *  state ("session not found"). */
    view: RalphSessionView | null | undefined;
    /** Click handler for an iteration node — wired to the chat detail
     *  switch in commit 7. */
    onSelectIteration?: (iteration: number) => void;
    onClose?: () => void;
    /** Override clock for tests. */
    now?: number;
    /** Default additional iterations applied when the user clicks "Continue loop"
     *  without providing an explicit override. Falls back to 20. */
    continueDefaultIterations?: number;
    /** Override the continue handler (used by tests). */
    onContinue?: (additionalIterations: number, aiSelection?: ResolvedModalJobAiSelection) => Promise<void>;
    /** Default additional iterations for "New Loop". Falls back to continueDefaultIterations or 20. */
    newLoopDefaultIterations?: number;
    /** Override the new-loop handler (used by tests). When omitted, falls back to the API call. */
    onNewLoop?: (newGoal: string, additionalIterations: number) => Promise<void>;
    /** Override the resume handler (used by tests). When omitted, calls the API directly. */
    onResume?: (aiSelection?: ResolvedModalJobAiSelection) => Promise<void>;
    /** Optional file name decoded from the Ralph session deep-link. */
    selectedFileName?: string;
    /** Called when the user selects a session file. Router wiring is owned by the deep-link slice. */
    onSelectFile?: (fileName: string) => void;
}

const PHASE_BADGE: Record<RalphSessionRecord['phase'], { label: string; cls: string }> = {
    grilling: { label: 'Clarifying', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
    executing: { label: 'Executing', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
    complete: { label: 'Complete', cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200' },
};

const TERMINAL_LABEL: Record<RalphTerminalReason, string> = {
    RALPH_COMPLETE: 'Completed',
    CAP_REACHED: 'Iteration cap reached',
    CANCELLED: 'Cancelled',
    NO_SIGNAL: 'Stopped — no signal',
};

function singleLine(s: string, max = 140): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function isMarkdownSessionFile(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function isJsonSessionFile(name: string): boolean {
    return name.toLowerCase().endsWith('.json');
}

interface SessionFileText {
    content: string;
    warning?: string;
}

function formatSessionFileText(file: RalphSessionFile): SessionFileText {
    if (!isJsonSessionFile(file.name)) {
        return { content: file.content };
    }

    try {
        return { content: JSON.stringify(JSON.parse(file.content), null, 2) };
    } catch (err) {
        if (err instanceof SyntaxError) {
            return {
                content: file.content,
                warning: 'Invalid JSON; showing raw text.',
            };
        }
        throw err;
    }
}

export function buildRalphResumeRequest(
    selection: ResolvedModalJobAiSelection | undefined,
): RalphResumeRequest | undefined {
    if (!selection) {
        return undefined;
    }
    const config: NonNullable<RalphResumeRequest['config']> = {};
    if (selection.model) config.model = selection.model;
    if (selection.reasoningEffort) config.reasoningEffort = selection.reasoningEffort;
    if (selection.effortTier) config.effortTier = selection.effortTier;

    const request: RalphResumeRequest = {};
    if (selection.provider) request.provider = selection.provider;
    if (selection.autoProviderRouting) request.autoProviderRouting = true;
    if (Object.keys(config).length > 0) request.config = config;

    return Object.keys(request).length > 0 ? request : undefined;
}

export function buildRalphContinueRequest(
    additionalIterations: number,
    selection: ResolvedModalJobAiSelection | undefined,
): RalphContinueRequest {
    const request: RalphContinueRequest = { additionalIterations };
    const ai = buildRalphResumeRequest(selection);
    if (ai?.provider) request.provider = ai.provider;
    if (ai?.config) request.config = ai.config;
    if (ai?.autoProviderRouting) request.autoProviderRouting = ai.autoProviderRouting;
    return request;
}

function hasRecoverableAiDefaults(defaults: RalphResumeAiDefaults | undefined): boolean {
    return Boolean(
        defaults?.provider
            || defaults?.model
            || defaults?.reasoningEffort
            || defaults?.effortTier
            || defaults?.autoProviderRouting,
    );
}

interface RalphSessionFileBrowserProps {
    sessionId: string;
    files: RalphSessionFile[];
    selectedFileName?: string;
    onSelectFile?: (fileName: string) => void;
}

function RalphSessionFileBrowser(props: RalphSessionFileBrowserProps): React.ReactElement {
    const { sessionId, files, selectedFileName: selectedFileNameProp, onSelectFile } = props;
    const [localSelectedFileName, setLocalSelectedFileName] = useState<string | null>(selectedFileNameProp ?? null);

    useEffect(() => {
        setLocalSelectedFileName(selectedFileNameProp ?? null);
    }, [selectedFileNameProp, sessionId]);

    const selectedFile = files.find((file) => file.name === localSelectedFileName) ?? files[0] ?? null;
    const selectedText = selectedFile && !isMarkdownSessionFile(selectedFile.name)
        ? formatSessionFileText(selectedFile)
        : null;

    const handleSelectFile = (fileName: string) => {
        setLocalSelectedFileName(fileName);
        onSelectFile?.(fileName);
    };

    return (
        <section
            className="flex min-h-[260px] w-full flex-col border-t border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950 xl:min-h-0 xl:w-[58%] xl:border-l xl:border-t-0"
            data-testid="ralph-session-files"
            aria-label="Ralph session files"
        >
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                    Session files
                </h3>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {files.length} {files.length === 1 ? 'file' : 'files'}
                </span>
            </div>

            {files.length === 0 ? (
                <div
                    className="flex flex-1 items-center justify-center px-4 py-6 text-xs italic text-zinc-500 dark:text-zinc-400"
                    data-testid="ralph-session-files-empty"
                >
                    No session files available.
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                    <nav
                        className="max-h-40 shrink-0 overflow-y-auto border-b border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950 md:max-h-none md:w-48 md:border-b-0 md:border-r"
                        aria-label="Ralph session file list"
                        data-testid="ralph-session-file-list"
                    >
                        <ul className="flex flex-col gap-1">
                            {files.map((file) => {
                                const active = file.name === selectedFile?.name;
                                return (
                                    <li key={file.name}>
                                        <button
                                            type="button"
                                            onClick={() => handleSelectFile(file.name)}
                                            className={cn(
                                                'w-full truncate rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors',
                                                active
                                                    ? 'bg-violet-100 text-violet-800 ring-1 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-100 dark:ring-violet-700'
                                                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900',
                                            )}
                                            aria-current={active ? 'true' : undefined}
                                            data-testid="ralph-session-file-item"
                                        >
                                            {file.name}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    <div className="min-w-0 flex-1 overflow-auto bg-white p-3 dark:bg-zinc-950" data-testid="ralph-session-file-content">
                        {selectedFile && isMarkdownSessionFile(selectedFile.name) ? (
                            <MarkdownView html={renderMarkdownToHtml(selectedFile.content)} />
                        ) : selectedFile && selectedText ? (
                            <div className="flex min-h-full flex-col gap-2">
                                {selectedText.warning && (
                                    <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="ralph-session-file-warning">
                                        {selectedText.warning}
                                    </p>
                                )}
                                <pre
                                    className="m-0 flex-1 whitespace-pre-wrap break-words rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                                    data-testid="ralph-session-file-text"
                                >
                                    {selectedText.content}
                                </pre>
                            </div>
                        ) : (
                            <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
                                Select a file to view its contents.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

export function RalphWorkflowPane(props: RalphWorkflowPaneProps): React.ReactElement {
    const {
        workspaceId,
        sessionId,
        view,
        onSelectIteration,
        onClose,
        continueDefaultIterations = 20,
        onContinue,
        newLoopDefaultIterations,
        onNewLoop,
        onResume,
        selectedFileName,
        onSelectFile,
    } = props;

    const [continueState, setContinueState] = useState<'idle' | 'confirm' | 'submitting'>('idle');
    const [continueError, setContinueError] = useState<string | null>(null);

    const [newLoopState, setNewLoopState] = useState<'idle' | 'confirm' | 'submitting'>('idle');
    const [newLoopGoal, setNewLoopGoal] = useState('');
    const [newLoopError, setNewLoopError] = useState<string | null>(null);

    const [resumeState, setResumeState] = useState<'idle' | 'confirm' | 'submitting'>('idle');
    const [resumeError, setResumeError] = useState<string | null>(null);
    const resumeDefaults = view && view !== null ? view.resumeDefaults : undefined;
    const resumeAiSelection = useModalJobAiSelection({
        workspaceId,
        mode: 'ralph',
        initialSelection: resumeDefaults,
    });
    const continueAiSelection = useModalJobAiSelection({
        workspaceId,
        mode: 'ralph',
        initialSelection: resumeDefaults,
    });

    if (view === undefined) {
        return (
            <div
                data-testid="ralph-workflow-pane-loading"
                className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400"
            >
                Loading Ralph session…
            </div>
        );
    }

    if (view === null) {
        return (
            <div
                data-testid="ralph-workflow-pane-empty"
                className="flex h-full flex-col items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
            >
                <p>Ralph session not found.</p>
                <p className="text-xs">Session id: <code className="font-mono">{sessionId}</code></p>
            </div>
        );
    }

    const { record, sections } = view;
    const phase = PHASE_BADGE[record.phase];
    const sectionByIter = new Map<number, ParsedProgressSection>();
    for (const s of sections) sectionByIter.set(s.iteration, s);

    const recordByIter = new Map<number, typeof record.iterations[number]>();
    for (const r of record.iterations) recordByIter.set(r.iteration, r);

    // Render one node per known iteration, in order. Use the union of both
    // sources so we don't drop nodes when only one side has the entry.
    const allIters = Array.from(new Set<number>([
        ...record.iterations.map(r => r.iteration),
        ...sections.map(s => s.iteration),
    ])).sort((a, b) => a - b);

    const isContinuable = record.phase === 'complete'
        && (record.terminalReason === 'CAP_REACHED'
            || record.terminalReason === 'NO_SIGNAL');

    const isRalphComplete = record.phase === 'complete'
        && record.terminalReason === 'RALPH_COMPLETE';

    const isStuckExecuting = record.phase === 'executing'
        && record.currentIteration > 0
        && !record.iterations.some(i => i.status === 'running');

    const handleResumeConfirmed = async () => {
        setResumeState('submitting');
        setResumeError(null);
        const resolvedResumeSelection = resumeAiSelection.dirty || !hasRecoverableAiDefaults(resumeDefaults)
            ? resumeAiSelection.resolved
            : undefined;
        try {
            if (onResume) {
                await onResume(resolvedResumeSelection);
            } else {
                await getSpaCocClient().workspaces.resumeRalphSession(
                    workspaceId,
                    sessionId,
                    buildRalphResumeRequest(resolvedResumeSelection),
                );
            }
            setResumeState('idle');
        } catch (err) {
            setResumeError(err instanceof Error ? err.message : String(err));
            setResumeState('confirm');
        }
    };

    const handleContinueConfirmed = async () => {
        setContinueState('submitting');
        setContinueError(null);
        const resolvedContinueSelection = continueAiSelection.dirty || !hasRecoverableAiDefaults(resumeDefaults)
            ? continueAiSelection.resolved
            : undefined;
        try {
            if (onContinue) {
                await onContinue(continueDefaultIterations, resolvedContinueSelection);
            } else {
                await getSpaCocClient().workspaces.continueRalphSession(
                    workspaceId,
                    sessionId,
                    buildRalphContinueRequest(continueDefaultIterations, resolvedContinueSelection),
                );
            }
            setContinueState('idle');
        } catch (err) {
            setContinueError(err instanceof Error ? err.message : String(err));
            setContinueState('confirm');
        }
    };

    const resolvedNewLoopIterations = newLoopDefaultIterations ?? continueDefaultIterations;

    const handleNewLoopConfirmed = async () => {
        const trimmed = newLoopGoal.trim();
        if (!trimmed) return;
        setNewLoopState('submitting');
        setNewLoopError(null);
        try {
            if (onNewLoop) {
                await onNewLoop(trimmed, resolvedNewLoopIterations);
            } else {
                await getSpaCocClient().workspaces.startNewRalphLoop(workspaceId, sessionId, {
                    newGoal: trimmed,
                    additionalIterations: resolvedNewLoopIterations,
                });
            }
            setNewLoopState('idle');
            setNewLoopGoal('');
        } catch (err) {
            setNewLoopError(err instanceof Error ? err.message : String(err));
            setNewLoopState('confirm');
        }
    };

    // Build a map of loop-start iterations → loop record for dividers.
    // Only populated when multi-loop is enabled and there are multiple loops.
    const loopStartMap = new Map<number, RalphLoopRecord>();
    if (RALPH_MULTI_LOOP && record.loops && record.loops.length > 1) {
        for (const loop of record.loops) {
            if (loop.loopIndex > 1) loopStartMap.set(loop.startIteration, loop);
        }
    }

    return (
        <div
            data-testid="ralph-workflow-pane"
            className="flex h-full flex-col overflow-hidden bg-white dark:bg-zinc-950"
        >
            {/* Header strip */}
            <div className="flex flex-wrap items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Ralph: {singleLine(record.originalGoal, 80)}
                        </h2>
                        <span
                            className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', phase.cls)}
                            data-testid="ralph-workflow-phase"
                        >
                            {phase.label}
                        </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                        <span data-testid="ralph-workflow-iteration-count">
                            Iteration {record.currentIteration} / {record.maxIterations}
                        </span>
                        {RALPH_MULTI_LOOP && record.loops && record.loops.length > 1 && (
                            <span data-testid="ralph-workflow-loop-count">
                                Loop {record.loops.length}
                            </span>
                        )}
                        <span>Started {formatRelativeTime(record.startedAt)}</span>
                        {record.completedAt && record.terminalReason && (
                            <span data-testid="ralph-workflow-terminal-reason">
                                {TERMINAL_LABEL[record.terminalReason] ?? record.terminalReason} ·{' '}
                                {formatRelativeTime(record.completedAt)}
                            </span>
                        )}
                        {isContinuable && continueState === 'idle' && (
                            <button
                                type="button"
                                onClick={() => { setContinueError(null); setContinueState('confirm'); }}
                                data-testid="ralph-workflow-continue"
                                className="rounded border border-blue-500 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50"
                            >
                                ↻ Continue loop
                            </button>
                        )}
                        {isStuckExecuting && resumeState === 'idle' && (
                            <button
                                type="button"
                                onClick={() => { setResumeError(null); setResumeState('confirm'); }}
                                data-testid="ralph-workflow-resume"
                                className="rounded border border-amber-500 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100 dark:border-amber-400 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
                            >
                                ↻ Resume
                            </button>
                        )}
                        {RALPH_MULTI_LOOP && isRalphComplete && newLoopState === 'idle' && (
                            <button
                                type="button"
                                onClick={() => { setNewLoopError(null); setNewLoopGoal(''); setNewLoopState('confirm'); }}
                                data-testid="ralph-workflow-new-loop"
                                className="rounded border border-violet-500 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 hover:bg-violet-100 dark:border-violet-400 dark:bg-violet-900/30 dark:text-violet-200 dark:hover:bg-violet-900/50"
                            >
                                ＋ New loop
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {/* Cancel is a stub for now — wired in a later commit. */}
                    <button
                        type="button"
                        disabled
                        title="Cancel (not implemented yet)"
                        className="cursor-not-allowed rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        Cancel
                    </button>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            data-testid="ralph-workflow-close"
                            className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col xl:flex-row" data-testid="ralph-workflow-body">
                {/* Timeline */}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="ralph-workflow-timeline">
                    {isStuckExecuting && resumeState !== 'idle' && (
                        <div
                            className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-700 dark:bg-amber-950/40"
                            data-testid="ralph-workflow-resume-confirm"
                        >
                            <p className="mb-2 font-semibold text-amber-900 dark:text-amber-100">
                                Resume this Ralph session?
                            </p>
                            <p className="mb-2 text-amber-800 dark:text-amber-200">
                                The session appears stuck (no task is running). Resuming will enqueue
                                iteration {record.currentIteration + 1} to pick up where it left off.
                            </p>
                            {resumeError && (
                                <p className="mb-2 text-red-700 dark:text-red-300" data-testid="ralph-workflow-resume-error">
                                    {resumeError}
                                </p>
                            )}
                            <div className="mb-2">
                                <div className="mb-1 text-[11px] font-medium text-amber-900 dark:text-amber-100">
                                    Agent:
                                </div>
                                <ModalJobAiControls
                                    selection={resumeAiSelection}
                                    disabled={resumeState === 'submitting'}
                                    testIdPrefix="ralph-workflow-resume"
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setResumeState('idle'); setResumeError(null); }}
                                    disabled={resumeState === 'submitting'}
                                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                    data-testid="ralph-workflow-resume-cancel"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResumeConfirmed}
                                    disabled={resumeState === 'submitting'}
                                    className="rounded border border-amber-500 bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                                    data-testid="ralph-workflow-resume-confirm-button"
                                >
                                    {resumeState === 'submitting' ? 'Resuming…' : 'Resume'}
                                </button>
                            </div>
                        </div>
                    )}
                    {isContinuable && continueState !== 'idle' && (
                        <div
                            className="mb-3 rounded border border-blue-300 bg-blue-50 p-3 text-xs dark:border-blue-700 dark:bg-blue-950/40"
                            data-testid="ralph-workflow-continue-confirm"
                        >
                            <p className="mb-2 font-semibold text-blue-900 dark:text-blue-100">
                                Continue this Ralph loop for {continueDefaultIterations} more iterations?
                            </p>
                            <p className="mb-2 text-blue-800 dark:text-blue-200">
                                New cap will be {record.maxIterations + continueDefaultIterations}. The journal
                                continues in the same progress.md.
                            </p>
                            {continueError && (
                                <p className="mb-2 text-red-700 dark:text-red-300" data-testid="ralph-workflow-continue-error">
                                    {continueError}
                                </p>
                            )}
                            <div className="mb-2">
                                <div className="mb-1 text-[11px] font-medium text-blue-900 dark:text-blue-100">
                                    Agent:
                                </div>
                                <ModalJobAiControls
                                    selection={continueAiSelection}
                                    disabled={continueState === 'submitting'}
                                    testIdPrefix="ralph-workflow-continue"
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setContinueState('idle'); setContinueError(null); }}
                                    disabled={continueState === 'submitting'}
                                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                    data-testid="ralph-workflow-continue-cancel"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleContinueConfirmed}
                                    disabled={continueState === 'submitting'}
                                    className="rounded border border-blue-500 bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                    data-testid="ralph-workflow-continue-confirm-button"
                                >
                                    {continueState === 'submitting' ? 'Continuing…' : 'Continue'}
                                </button>
                            </div>
                        </div>
                    )}
                    {RALPH_MULTI_LOOP && isRalphComplete && newLoopState !== 'idle' && (
                        <div
                            className="mb-3 rounded border border-violet-300 bg-violet-50 p-3 text-xs dark:border-violet-700 dark:bg-violet-950/40"
                            data-testid="ralph-workflow-new-loop-confirm"
                        >
                            <p className="mb-2 font-semibold text-violet-900 dark:text-violet-100">
                                Start a new loop with a different goal?
                            </p>
                            <p className="mb-2 text-violet-800 dark:text-violet-200">
                                The session journal and all prior iterations are preserved. Budget: {resolvedNewLoopIterations} iterations.
                            </p>
                            <textarea
                                rows={3}
                                placeholder="Describe the new goal…"
                                value={newLoopGoal}
                                onChange={e => setNewLoopGoal(e.target.value)}
                                disabled={newLoopState === 'submitting'}
                                data-testid="ralph-workflow-new-loop-goal"
                                className="mb-2 w-full resize-none rounded border border-violet-300 bg-white px-2 py-1 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50 dark:border-violet-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                            />
                            {newLoopError && (
                                <p className="mb-2 text-red-700 dark:text-red-300" data-testid="ralph-workflow-new-loop-error">
                                    {newLoopError}
                                </p>
                            )}
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setNewLoopState('idle'); setNewLoopError(null); setNewLoopGoal(''); }}
                                    disabled={newLoopState === 'submitting'}
                                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                    data-testid="ralph-workflow-new-loop-cancel"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleNewLoopConfirmed}
                                    disabled={newLoopState === 'submitting' || !newLoopGoal.trim()}
                                    className="rounded border border-violet-500 bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                                    data-testid="ralph-workflow-new-loop-confirm-button"
                                >
                                    {newLoopState === 'submitting' ? 'Starting…' : 'Start new loop'}
                                </button>
                            </div>
                        </div>
                    )}
                    {allIters.length === 0 ? (
                        <div className="text-xs italic text-zinc-500 dark:text-zinc-400">
                            Waiting for the first iteration to complete…
                        </div>
                    ) : (
                        <ol className="flex flex-col gap-2">
                            {allIters.map(iter => {
                                const loopDivider = loopStartMap.get(iter);
                                return (
                                    <li key={iter}>
                                        {loopDivider && (
                                            <div
                                                className="mb-2 mt-3 flex items-center gap-2"
                                                data-testid={`ralph-loop-divider-${loopDivider.loopIndex}`}
                                            >
                                                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                                                    Loop {loopDivider.loopIndex}
                                                </span>
                                                <span className="min-w-0 truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                                                    {singleLine(loopDivider.goal, 100)}
                                                </span>
                                                <span className="h-px flex-1 bg-violet-200 dark:bg-violet-800" />
                                            </div>
                                        )}
                                        <RalphWorkflowNode
                                            iteration={iter}
                                            record={recordByIter.get(iter)}
                                            section={sectionByIter.get(iter)}
                                            isCurrent={record.phase === 'executing' && iter === record.currentIteration}
                                            onClick={onSelectIteration}
                                        />
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>
                <RalphSessionFileBrowser
                    sessionId={sessionId}
                    files={view.files ?? []}
                    selectedFileName={selectedFileName}
                    onSelectFile={onSelectFile}
                />
            </div>
        </div>
    );
}
