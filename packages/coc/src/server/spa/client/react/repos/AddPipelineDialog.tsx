/**
 * AddPipelineDialog — create-pipeline dialog with name input and template selector.
 */

import { useState } from 'react';
import { Button, Dialog } from '../shared';
import { useGlobalToast } from '../context/ToastContext';
import { createPipeline } from './pipeline-api';

const TEMPLATES = [
    { value: 'custom', label: 'Custom (blank)' },
    { value: 'data-fanout', label: 'Data Fan-out' },
    { value: 'model-fanout', label: 'Model Fan-out' },
    { value: 'ai-generated', label: 'AI Generated' },
] as const;

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

export interface AddPipelineDialogProps {
    workspaceId: string;
    onCreated: () => void;
    onClose: () => void;
}

export function AddPipelineDialog({ workspaceId, onCreated, onClose }: AddPipelineDialogProps) {
    const { addToast } = useGlobalToast();
    const [name, setName] = useState('');
    const [template, setTemplate] = useState<string>('custom');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            addToast('Pipeline created', 'success');
            onCreated();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to create pipeline');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog
            open
            onClose={onClose}
            title="New Pipeline"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button loading={submitting} onClick={handleSubmit}>Create</Button>
                </>
            }
        >
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
                {error && (
                    <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5">
                        {error}
                    </div>
                )}
            </div>
        </Dialog>
    );
}
