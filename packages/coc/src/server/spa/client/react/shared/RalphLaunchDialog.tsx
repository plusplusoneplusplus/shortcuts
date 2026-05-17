/**
 * RalphLaunchDialog — lightweight dialog for launching Ralph from a goal file.
 * Used by the notes editor when editing a goal.md / *.goal.md file.
 */
import { useState } from 'react';
import { getApiBase, isRalphEnabled } from '../utils/config';
import { useModels } from '../hooks/useModels';

export interface RalphLaunchDialogProps {
    open: boolean;
    workspaceId: string;
    /** Display name of the source file (e.g., "auth-refactor.goal.md") */
    sourceLabel: string;
    /** The goal spec content (markdown from the editor) */
    goalSpec: string;
    /** Working directory / folder path for the Ralph session */
    folderPath?: string;
    onClose: () => void;
    /** Called with the new processId after successful launch */
    onLaunched: (processId: string) => void;
}

export function RalphLaunchDialog({
    open,
    workspaceId,
    sourceLabel,
    goalSpec,
    folderPath,
    onClose,
    onLaunched,
}: RalphLaunchDialogProps) {
    const { models } = useModels();
    const enabledModels = models.filter(m => m.enabled);
    const [selectedModel, setSelectedModel] = useState('');
    const [launching, setLaunching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    async function handleLaunch() {
        const trimmed = goalSpec.trim();
        if (!trimmed) {
            setError('Goal spec is empty. Edit the file in the editor first.');
            return;
        }
        setLaunching(true);
        setError(null);
        try {
            const body: Record<string, unknown> = { goalSpec: trimmed, workspaceId };
            if (folderPath) body.folderPath = folderPath;
            if (selectedModel) body.config = { model: selectedModel };
            const resp = await fetch(`${getApiBase()}/ralph-launch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!resp.ok) {
                const text = await resp.text();
                let msg = text;
                try {
                    const parsed = JSON.parse(text);
                    if (parsed?.error) msg = parsed.error;
                } catch { /* use raw text */ }
                throw new Error(msg || `HTTP ${resp.status}`);
            }
            const result = await resp.json();
            onLaunched(result.processId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to launch Ralph');
        } finally {
            setLaunching(false);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="ralph-launch-dialog"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white dark:bg-[#252526] rounded-lg shadow-xl w-full max-w-lg mx-4 border border-[#e0e0e0] dark:border-[#3c3c3c]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        🔄 Launch Ralph Loop
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="px-4 py-3 space-y-3">
                    {/* Source label */}
                    <div className="text-xs text-[#848484]">
                        Goal source: <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{sourceLabel}</span>
                    </div>

                    {/* Model selector */}
                    <div>
                        <label htmlFor="ralph-model-select" className="block text-xs text-[#848484] mb-1">
                            Model:
                        </label>
                        <select
                            id="ralph-model-select"
                            data-testid="ralph-model-select"
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="w-full rounded border border-[#d0d0d0] dark:border-[#4a4a4a] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] px-2 py-1"
                        >
                            <option value="">Default</option>
                            {enabledModels.map(m => (
                                <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                            ))}
                        </select>
                    </div>

                    {/* Goal preview */}
                    <div>
                        <div className="text-xs text-[#848484] mb-1">Goal preview:</div>
                        <textarea
                            readOnly
                            data-testid="ralph-goal-preview"
                            value={goalSpec}
                            rows={8}
                            className="w-full rounded border border-[#d0d0d0] dark:border-[#4a4a4a] bg-[#f5f5f5] dark:bg-[#1a1a1a] text-xs text-[#1e1e1e] dark:text-[#cccccc] p-2 font-mono resize-y"
                        />
                        <div className="text-[10px] text-[#848484] mt-0.5">
                            Read-only preview — edit in the editor above
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <p className="text-xs text-[#f14c4c]" data-testid="ralph-launch-error">
                            {error}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={launching}
                        className="text-sm px-3 py-1.5 text-[#5a5a5a] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#ccc]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        data-testid="ralph-launch-confirm-btn"
                        onClick={handleLaunch}
                        disabled={launching}
                        className={
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors ' +
                            (launching
                                ? 'bg-purple-400 cursor-not-allowed'
                                : 'bg-purple-600 hover:bg-purple-700')
                        }
                    >
                        {launching ? '⏳ Launching…' : '🔄 Launch Ralph'}
                    </button>
                </div>
            </div>
        </div>
    );
}
