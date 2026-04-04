/**
 * RunScriptDialog — form to enqueue a run-script task.
 * Posts to POST /api/queue/tasks with type 'run-script'.
 * On desktop: renders as a draggable/resizable FloatingDialog with minimize-to-tray.
 * On mobile: falls back to a full-screen modal Dialog.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { Dialog, FloatingDialog, Button } from '../shared';
import { useModels } from '../hooks/useModels';
import { useScriptTemplates, type ScriptTemplate } from '../hooks/useScriptTemplates';
import { getApiBase } from '../utils/config';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useMinimizedDialog } from '../context/MinimizedDialogsContext';

export function RunScriptDialog() {
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();
    const { isMobile } = useBreakpoint();
    const open = queueState.showScriptDialog;

    const [script, setScript] = useState('');
    const [args, setArgs] = useState('');
    const [workingDir, setWorkingDir] = useState('');
    const [model, setModel] = useState('');
    const [pauseOnFailure, setPauseOnFailure] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState<'form' | 'templates'>('form');
    const [saveName, setSaveName] = useState('');
    const [showSaveInput, setShowSaveInput] = useState(false);
    const [minimized, setMinimized] = useState(false);

    const workspaceId = queueState.scriptDialogWorkspaceId || appState.workspaces?.[0]?.id || '';
    const { models: modelInfos } = useModels();
    const enabledModels = modelInfos.filter(m => m.enabled);
    const models = (enabledModels.length > 0 ? enabledModels : modelInfos).map(m => m.id);
    const { templates, saveTemplate, deleteTemplate, loaded: templatesLoaded } = useScriptTemplates(workspaceId || undefined);

    // Pre-fill working directory when opened from a repo action bar
    useEffect(() => {
        if (!open) return;
        if (queueState.scriptDialogWorkspaceId) {
            const ws = appState.workspaces?.find((w: any) => w.id === queueState.scriptDialogWorkspaceId);
            setWorkingDir(ws?.rootPath ?? '');
        } else {
            setWorkingDir('');
        }
    }, [open]);

    const close = useCallback(() => {
        queueDispatch({ type: 'CLOSE_SCRIPT_DIALOG' });
    }, [queueDispatch]);

    const handleMinimize = useCallback(() => setMinimized(true), []);
    const handleRestore = useCallback(() => setMinimized(false), []);
    const handleClose = useCallback(() => {
        setMinimized(false);
        queueDispatch({ type: 'CLOSE_SCRIPT_DIALOG' });
    }, [queueDispatch]);

    // Reset minimized state when dialog closes externally
    useEffect(() => {
        if (!open) setMinimized(false);
    }, [open]);

    // Pill preview: first 40 characters of the script/command field
    const pillPreview = script.trim().length > 0 ? script.trim().slice(0, 40) : undefined;

    const minimizedEntry = useMemo(() => {
        if (!minimized || !open) return null;
        return {
            id: 'run-script',
            icon: '⚡',
            label: 'Run Script',
            preview: pillPreview,
            onRestore: handleRestore,
            onClose: handleClose,
        };
    }, [minimized, open, pillPreview, handleRestore, handleClose]);
    useMinimizedDialog(minimizedEntry);

    const reset = useCallback(() => {
        setScript('');
        setArgs('');
        setWorkingDir('');
        setModel('');
        setPauseOnFailure(false);
        setShowSaveInput(false);
        setSaveName('');
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!script.trim()) return;
        setSubmitting(true);
        try {
            const fullScript = args.trim() ? `${script.trim()} ${args.trim()}` : script.trim();
            const displayName = script.trim().split(/[\\/]/).pop() || script.trim();
            const payload: Record<string, unknown> = { script: fullScript };
            if (workingDir.trim()) payload.workingDirectory = workingDir.trim();

            const config: Record<string, unknown> = {};
            if (model) config.model = model;
            if (pauseOnFailure) config.pauseOnFailure = true;

            await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'run-script',
                    displayName,
                    payload,
                    config,
                    repoId: workspaceId || undefined,
                }),
            });

            const data = await fetch(getApiBase() + '/queue').then(r => r.json());
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
            reset();
            close();
        } finally {
            setSubmitting(false);
        }
    }, [script, args, workingDir, model, pauseOnFailure, workspaceId, queueDispatch, close, reset]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !submitting) {
            e.preventDefault();
            handleSubmit();
        }
    }, [submitting, handleSubmit]);

    const handleSaveTemplate = useCallback(() => {
        if (!saveName.trim() || !script.trim()) return;
        saveTemplate({
            name: saveName.trim(),
            scriptPath: script.trim(),
            args: args.trim() || undefined,
            workingDirectory: workingDir.trim() || undefined,
            model: model || undefined,
            pauseOnFailure: pauseOnFailure || undefined,
        });
        setShowSaveInput(false);
        setSaveName('');
    }, [saveName, script, args, workingDir, model, pauseOnFailure, saveTemplate]);

    const applyTemplate = useCallback((t: ScriptTemplate) => {
        setScript(t.scriptPath);
        setArgs(t.args || '');
        setWorkingDir(t.workingDirectory || '');
        setModel(t.model || '');
        setPauseOnFailure(!!t.pauseOnFailure);
        setActiveTab('form');
    }, []);

    if (!open) return null;
    if (minimized) return null;

    const dialogContent = (
        <div className="flex flex-col gap-3" data-testid="run-script-dialog" onKeyDown={handleKeyDown}>
            {/* Tabs */}
            <div className="flex gap-2 mb-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <button
                    className={`text-xs pb-1 px-2 ${activeTab === 'form' ? 'border-b-2 border-[#0078d4] font-medium' : 'text-[#848484]'}`}
                    onClick={() => setActiveTab('form')}
                >
                    Script
                </button>
                <button
                    className={`text-xs pb-1 px-2 ${activeTab === 'templates' ? 'border-b-2 border-[#0078d4] font-medium' : 'text-[#848484]'}`}
                    onClick={() => setActiveTab('templates')}
                >
                    Templates ({templates.length})
                </button>
            </div>

            {activeTab === 'form' && (
                <div className="flex flex-col gap-3">
                    {/* Script / Command */}
                    <label className="text-xs">
                        <span className="font-medium">Script / Command</span>
                        <input
                            type="text"
                            className="mt-1 w-full rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] px-2 py-1 text-xs"
                            placeholder="./scripts/lint.sh or npm test"
                            value={script}
                            onChange={e => setScript(e.target.value)}
                            data-testid="script-input"
                            autoFocus
                        />
                    </label>

                    {/* Args */}
                    <label className="text-xs">
                        <span className="font-medium">Args (optional)</span>
                        <input
                            type="text"
                            className="mt-1 w-full rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] px-2 py-1 text-xs"
                            placeholder="--fix --verbose"
                            value={args}
                            onChange={e => setArgs(e.target.value)}
                            data-testid="args-input"
                        />
                    </label>

                    {/* Working Directory */}
                    <label className="text-xs">
                        <span className="font-medium">Working Directory (optional)</span>
                        <input
                            type="text"
                            className="mt-1 w-full rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] px-2 py-1 text-xs"
                            placeholder="Defaults to repo root"
                            value={workingDir}
                            onChange={e => setWorkingDir(e.target.value)}
                            data-testid="working-dir-input"
                        />
                    </label>

                    {/* Model */}
                    <label className="text-xs">
                        <span className="font-medium">Model</span>
                        <select
                            className="mt-1 w-full rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] px-2 py-1 text-xs"
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            data-testid="model-select"
                        >
                            <option value="">Default</option>
                            {models.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <span className="mt-1 block text-[#848484]">Not used for script execution. Saved with templates for future use.</span>
                    </label>

                    {/* Pause on Failure toggle */}
                    <label className="flex items-center gap-2 text-xs">
                        <input
                            type="checkbox"
                            checked={pauseOnFailure}
                            onChange={e => setPauseOnFailure(e.target.checked)}
                            data-testid="pause-on-failure-toggle"
                        />
                        <span>⚠ Pause queue on failure</span>
                    </label>

                    {/* Save as template */}
                    {showSaveInput ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                className="flex-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] px-2 py-1 text-xs"
                                placeholder="Template name"
                                value={saveName}
                                onChange={e => setSaveName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveTemplate(); }}
                                data-testid="template-name-input"
                                autoFocus
                            />
                            <Button variant="ghost" size="sm" onClick={handleSaveTemplate}>Save</Button>
                            <Button variant="ghost" size="sm" onClick={() => setShowSaveInput(false)}>Cancel</Button>
                        </div>
                    ) : (
                        <Button variant="ghost" size="sm" onClick={() => setShowSaveInput(true)} data-testid="save-template-btn">
                            💾 Save as template…
                        </Button>
                    )}
                </div>
            )}

            {activeTab === 'templates' && (
                <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto">
                    {!templatesLoaded && <div className="text-xs text-[#848484] p-2">Loading...</div>}
                    {templatesLoaded && templates.length === 0 && (
                        <div className="text-xs text-[#848484] p-2">No saved templates.</div>
                    )}
                    {templates.map(t => (
                        <div
                            key={t.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] cursor-pointer text-xs"
                            data-testid={`template-${t.id}`}
                        >
                            <button className="flex-1 text-left truncate" onClick={() => applyTemplate(t)}>
                                <span className="font-medium">{t.name}</span>
                                <span className="ml-2 text-[#848484]">{t.scriptPath}</span>
                            </button>
                            <button
                                className="text-[#848484] hover:text-[#f14c4c]"
                                onClick={() => deleteTemplate(t.id)}
                                title="Delete template"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const footer = (
        <>
            <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
            <Button
                variant="primary"
                size="sm"
                disabled={!script.trim() || submitting}
                onClick={handleSubmit}
                data-testid="enqueue-script-btn"
                title="Ctrl+Enter"
            >
                {submitting ? 'Enqueuing…' : '▶ Enqueue'}
            </Button>
        </>
    );

    if (!isMobile) {
        return (
            <FloatingDialog
                open={true}
                onClose={close}
                onMinimize={handleMinimize}
                title="⚡ Run Script"
                footer={footer}
                resizable
                minWidth={520}
                minHeight={420}
            >
                {dialogContent}
            </FloatingDialog>
        );
    }

    return (
        <Dialog open={true} onClose={close} onMinimize={handleMinimize} title="⚡ Run Script" footer={footer}>
            {dialogContent}
        </Dialog>
    );
}
