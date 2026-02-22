/**
 * GenerateTaskDialog — modal dialog for AI-powered task generation.
 *
 * Wires up the useTaskGeneration hook, renders a form for prompt/name/folder/model,
 * streams live output while the AI runs, and notifies the parent on success.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Dialog, Button, Spinner } from '../shared';
import { useTaskGeneration } from '../hooks/useTaskGeneration';
import { usePreferences } from '../hooks/usePreferences';
import { type TaskFolder } from '../hooks/useTaskTree';
import { getApiBase } from '../utils/config';

// ── helpers ──────────────────────────────────────────────────────────────────

function flattenFolders(folder: TaskFolder, acc: string[] = []): string[] {
    acc.push(folder.relativePath);
    for (const child of folder.children) flattenFolders(child, acc);
    return acc;
}

// ── props ────────────────────────────────────────────────────────────────────

export interface GenerateTaskDialogProps {
    /** Workspace id passed to useTaskGeneration and used to fetch folders/models. */
    wsId: string;
    /** Pre-selected target folder path (relative). Empty string = root. */
    initialFolder?: string;
    /** Called when generation finishes successfully; receives the created file path. */
    onSuccess: (filePath: string) => void;
    /** Called when the user cancels or closes without completing. */
    onClose: () => void;
}

// ── component ────────────────────────────────────────────────────────────────

export function GenerateTaskDialog({
    wsId,
    initialFolder = '',
    onSuccess,
    onClose,
}: GenerateTaskDialogProps) {
    // --- preferences (persisted model) ---
    const { model: savedModel, setModel: persistModel } = usePreferences();

    // --- form state ---
    const [prompt, setPrompt] = useState('');
    const [name, setName] = useState('');
    const [targetFolder, setTargetFolder] = useState(initialFolder);
    const [model, setModel] = useState('');

    useEffect(() => {
        if (savedModel && !model) setModel(savedModel);
    }, [savedModel]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- data ---
    const [models, setModels] = useState<string[]>([]);
    const [folders, setFolders] = useState<string[]>(['']);

    // --- hook ---
    const { status, chunks, progressMessage, result, error, generate, cancel, reset } =
        useTaskGeneration(wsId);

    // --- fetch models on mount ---
    useEffect(() => {
        let cancelled = false;
        fetch(getApiBase() + '/queue/models')
            .then(r => (r.ok ? r.json() : []))
            .then(data => {
                if (!cancelled) setModels(data?.models ?? (Array.isArray(data) ? data : []));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // --- fetch task folders on mount ---
    useEffect(() => {
        let cancelled = false;
        fetch(getApiBase() + `/workspaces/${encodeURIComponent(wsId)}/tasks`)
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                if (!cancelled && data) {
                    const paths = flattenFolders(data as TaskFolder);
                    setFolders(paths);
                }
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [wsId]);

    // --- scroll output panel to bottom on new chunks ---
    const outputRef = useRef<HTMLPreElement>(null);
    useEffect(() => {
        if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, [chunks]);

    // --- notify parent after success ---
    useEffect(() => {
        if (status === 'complete' && result?.filePath) {
            onSuccess(result.filePath);
        }
    }, [status, result, onSuccess]);

    const handleGenerate = useCallback(() => {
        generate({
            prompt: prompt.trim(),
            name: name.trim() || undefined,
            targetFolder: targetFolder || undefined,
            model: model || undefined,
            mode: 'from-feature',
            depth: 'deep',
        });
    }, [prompt, name, targetFolder, model, generate]);

    const isGenerating = status === 'generating';
    const isComplete = status === 'complete';
    const isError = status === 'error';

    // no-op handler prevents accidental close while streaming
    const noop = useCallback(() => {}, []);

    const footer = (
        <>
            <Button
                id="gen-task-cancel"
                variant="secondary"
                onClick={() => {
                    if (isGenerating) cancel();
                    onClose();
                }}
            >
                {isGenerating ? 'Cancel' : 'Close'}
            </Button>
            <Button
                id="gen-task-generate"
                onClick={handleGenerate}
                loading={isGenerating}
                disabled={!prompt.trim() || isComplete}
            >
                Generate
            </Button>
        </>
    );

    return (
        <Dialog
            open
            id="generate-task-overlay"
            onClose={isGenerating ? noop : onClose}
            title="Generate Task"
            className="max-w-[600px]"
            footer={footer}
        >
            <div className="flex flex-col gap-4">
                {/* Close × button */}
                <button
                    id="gen-task-close"
                    className="absolute top-3 right-3 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                    onClick={isGenerating ? undefined : onClose}
                    aria-label="Close"
                >
                    ×
                </button>

                {/* Prompt textarea (required) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">Prompt</label>
                    <textarea
                        id="gen-task-prompt"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] resize-y min-h-[80px]"
                        rows={4}
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        disabled={isGenerating || isComplete}
                        placeholder="Describe the task to generate…"
                    />
                </div>

                {/* Task name (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Task name <span className="text-[#848484]">(optional)</span>
                    </label>
                    <input
                        id="gen-task-name"
                        type="text"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isGenerating || isComplete}
                        placeholder="Leave blank — AI will decide"
                    />
                </div>

                {/* Target folder (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Target folder <span className="text-[#848484]">(optional)</span>
                    </label>
                    <select
                        id="gen-task-folder"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={targetFolder}
                        onChange={e => setTargetFolder(e.target.value)}
                        disabled={isGenerating || isComplete}
                    >
                        <option value="">Root</option>
                        {folders
                            .filter(f => f !== '')
                            .map(f => (
                                <option key={f} value={f}>
                                    {f}
                                </option>
                            ))}
                    </select>
                </div>

                {/* Model (optional) */}
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#616161] dark:text-[#999]">
                        Model <span className="text-[#848484]">(optional)</span>
                    </label>
                    <select
                        id="gen-task-model"
                        className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        value={model}
                        onChange={e => {
                            setModel(e.target.value);
                            persistModel(e.target.value);
                        }}
                        disabled={isGenerating || isComplete}
                    >
                        <option value="">Default</option>
                        {models.map(m => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Streaming output panel */}
                {status !== 'idle' && (
                    <div className="flex flex-col gap-1">
                        <div className="text-xs text-[#616161] dark:text-[#999]">
                            {isGenerating && (
                                <>
                                    <Spinner size="sm" /> {progressMessage || 'Generating…'}
                                </>
                            )}
                            {isComplete && (
                                <span className="text-green-600 dark:text-green-400">✓ Done</span>
                            )}
                            {isError && <span className="text-red-500">✗ Error</span>}
                        </div>
                        <pre
                            ref={outputRef}
                            id="gen-task-output"
                            className="text-xs font-mono bg-[#1e1e1e] text-[#cccccc] rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap"
                        >
                            {chunks.join('')}
                        </pre>
                    </div>
                )}

                {/* Success banner */}
                {isComplete && result?.filePath && (
                    <div
                        id="gen-task-success"
                        className="text-xs text-green-600 dark:text-green-400 break-all"
                    >
                        Created: {result.filePath}
                    </div>
                )}

                {/* Error banner with Retry */}
                {isError && (
                    <div
                        id="gen-task-error"
                        className="flex items-center gap-2 text-xs text-red-500"
                    >
                        <span>{error}</span>
                        <button className="underline" onClick={reset}>
                            Retry
                        </button>
                    </div>
                )}
            </div>
        </Dialog>
    );
}
