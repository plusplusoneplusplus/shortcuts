/**
 * AddPipelineDialog — create-pipeline dialog with name input, template selector,
 * and AI generation flow (input → generating → preview).
 */

import { useState, useRef } from 'react';
import { Button, Dialog, Badge, Spinner } from '../shared';
import { useGlobalToast } from '../context/ToastContext';
import { createPipeline, generatePipeline } from './pipeline-api';

const TEMPLATES = [
    { value: 'custom', label: 'Custom (blank)' },
    { value: 'data-fanout', label: 'Data Fan-out' },
    { value: 'model-fanout', label: 'Model Fan-out' },
    { value: 'ai-generated', label: 'AI Generated (describe in natural language)' },
] as const;

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

type DialogPhase = 'input' | 'generating' | 'preview';

export interface AddPipelineDialogProps {
    workspaceId: string;
    onCreated: (name?: string) => void;
    onClose: () => void;
}

export function AddPipelineDialog({ workspaceId, onCreated, onClose }: AddPipelineDialogProps) {
    const { addToast } = useGlobalToast();
    const [name, setName] = useState('');
    const [template, setTemplate] = useState<string>('custom');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [phase, setPhase] = useState<DialogPhase>('input');
    const [description, setDescription] = useState('');
    const [generatedYaml, setGeneratedYaml] = useState('');
    const [generatedValid, setGeneratedValid] = useState(false);
    const [generationErrors, setGenerationErrors] = useState<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    const isAiMode = template === 'ai-generated';

    async function handleSubmit() {
        const trimmed = name.trim();
        if (!trimmed) {
            setError('Name is required');
            return;
        }
        if (!NAME_PATTERN.test(trimmed)) {
            setError('Name must start with a letter or number and contain only letters, numbers, and hyphens');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await createPipeline(workspaceId, trimmed, template);
            addToast('Workflow created', 'success');
            onCreated(trimmed);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create workflow');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleGenerate() {
        const trimmed = name.trim();
        if (!isAiMode && !trimmed) { setError('Name is required'); return; }
        if (trimmed && !NAME_PATTERN.test(trimmed)) {
            setError('Name must start with a letter or number and contain only letters, numbers, and hyphens');
            return;
        }
        if (description.trim().length < 10) { setError('Please provide more detail'); return; }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setPhase('generating');
        setError(null);

        try {
            const result = await generatePipeline(workspaceId, trimmed || undefined, description.trim(), controller.signal);
            setGeneratedYaml(result.yaml);
            setGeneratedValid(result.valid);
            setGenerationErrors(result.validationError ? [result.validationError] : []);
            // If user didn't provide a name, use the AI-suggested name
            if (!trimmed && result.suggestedName) {
                setName(result.suggestedName);
            }
            setPhase('preview');
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setPhase('input');
            } else {
                setError(err.message || 'Generation failed. Please try again.');
                setPhase('input');
            }
        }
    }

    async function handleSave() {
        const trimmed = name.trim();
        if (!trimmed) {
            setError('Name is required');
            return;
        }
        if (!NAME_PATTERN.test(trimmed)) {
            setError('Name must start with a letter or number and contain only letters, numbers, and hyphens');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await createPipeline(workspaceId, trimmed, undefined, generatedYaml);
            addToast('Workflow created', 'success');
            onCreated(trimmed);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create workflow');
        } finally {
            setSubmitting(false);
        }
    }

    function handleCancel() {
        abortRef.current?.abort();
        if (phase === 'generating') {
            setPhase('input');
        } else {
            onClose();
        }
    }

    const dialogTitle =
        phase === 'preview' ? 'Review Generated Workflow' :
        phase === 'generating' ? 'Generating...' :
        'New Workflow';

    const footer = (() => {
        if (phase === 'generating') {
            return <Button variant="secondary" onClick={handleCancel}>Cancel</Button>;
        }
        if (phase === 'preview') {
            return (
                <>
                    <Button variant="secondary" onClick={() => setPhase('input')}>← Back</Button>
                    <Button variant="secondary" onClick={handleGenerate}>Regenerate 🔄</Button>
                    <Button loading={submitting} onClick={handleSave}>Save Workflow ✓</Button>
                </>
            );
        }
        if (isAiMode) {
            return (
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        disabled={description.trim().length < 10}
                        onClick={handleGenerate}
                    >
                        Generate Workflow ✨
                    </Button>
                </>
            );
        }
        return (
            <>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button loading={submitting} onClick={handleSubmit}>Create</Button>
            </>
        );
    })();

    return (
        <Dialog
            open
            onClose={handleCancel}
            title={dialogTitle}
            className={phase === 'preview' ? 'max-w-[640px]' : undefined}
            footer={footer}
        >
            {phase === 'generating' && (
                <div className="flex flex-col items-center gap-3 py-4">
                    <Spinner size="lg" />
                    <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Generating workflow YAML...</div>
                    <div className="text-xs text-[#848484]">⏱ This usually takes 10–30 seconds.</div>
                </div>
            )}

            {phase === 'preview' && (
                <div className="flex flex-col gap-3">
                    <div>
                        <label className="block text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => { setName(e.target.value); setError(null); }}
                            placeholder="my-pipeline"
                            className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                        />
                    </div>

                    <pre className="font-mono text-xs overflow-auto whitespace-pre-wrap bg-[#f5f5f5] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3 max-h-[300px]">
                        {generatedYaml}
                    </pre>

                    <div className="flex items-center gap-2">
                        {generatedValid ? (
                            <Badge status="completed">✅ Valid workflow</Badge>
                        ) : (
                            <Badge status="warning">⚠️ Invalid workflow</Badge>
                        )}
                    </div>

                    {!generatedValid && generationErrors.length > 0 && (
                        <details className="text-xs text-[#848484]">
                            <summary className="cursor-pointer">Validation errors ({generationErrors.length})</summary>
                            <ul className="mt-1 ml-4 list-disc">
                                {generationErrors.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                        </details>
                    )}

                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5">
                            {error}
                        </div>
                    )}
                </div>
            )}

            {phase === 'input' && (
                <div className="flex flex-col gap-3">
                    <div>
                        <label className="block text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => { setName(e.target.value); setError(null); }}
                            placeholder={isAiMode ? 'Leave blank for AI suggestion' : 'my-pipeline'}
                            className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">Template</label>
                        <select
                            value={template}
                            onChange={e => setTemplate(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded"
                        >
                            {TEMPLATES.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                        </select>
                    </div>

                    {isAiMode && (
                        <>
                            <div>
                                <label className="block text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                                    Describe what your workflow should do
                                </label>
                                <textarea
                                    value={description}
                                    onChange={e => { setDescription(e.target.value.slice(0, 2000)); setError(null); }}
                                    placeholder="e.g., Read a CSV of customer tickets, classify each by urgency and department, then summarize counts by category"
                                    rows={5}
                                    className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-none"
                                />
                                <div className={`text-xs mt-1 ${description.length > 1900 ? 'text-red-500' : 'text-[#848484]'}`}>
                                    {description.length} / 2000 characters
                                </div>
                            </div>

                            <div className="flex items-start gap-2 px-3 py-2 text-xs bg-[#e8f4fd] dark:bg-[#0078d4]/10 border border-[#b8daff] dark:border-[#0078d4]/30 rounded">
                                <span>💡</span>
                                <span className="text-[#1e1e1e] dark:text-[#cccccc]">
                                    Tip: Mention your data source, what to do with each item, and what the final output should look like.
                                </span>
                            </div>
                        </>
                    )}

                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5">
                            {error}
                        </div>
                    )}
                </div>
            )}
        </Dialog>
    );
}
