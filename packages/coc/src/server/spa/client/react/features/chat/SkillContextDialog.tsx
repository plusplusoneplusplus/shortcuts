import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui';
import { ModalJobAiControls, type ResolvedModalJobAiSelection, useModalJobAiSelection } from '../../shared/ModalJobAiControls';

export interface SkillContextDialogProps {
    open: boolean;
    workspaceId?: string;
    skillName: string;
    targetSummary: string;
    onClose: () => void;
    onConfirm: (userContext: string, aiSelection: ResolvedModalJobAiSelection) => Promise<void>;
}

export function SkillContextDialog({ open, workspaceId, skillName, targetSummary, onClose, onConfirm }: SkillContextDialogProps) {
    const [userContext, setUserContext] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'autopilot' });

    useEffect(() => {
        if (open) {
            setUserContext('');
            setLoading(false);
            setError(null);
        }
    }, [open]);

    const handleConfirm = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            await onConfirm(userContext.trim(), aiSelection.resolved);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to enqueue skill');
        } finally {
            setLoading(false);
        }
    }, [aiSelection.resolved, onConfirm, userContext]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={`Run Skill: ${skillName}`}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleConfirm} disabled={loading}>
                        {loading ? 'Running…' : 'Run'}
                    </Button>
                </>
            }
        >
            <p className="text-xs text-[#848484] dark:text-[#999] mb-2">{targetSummary}</p>
            <textarea
                className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                rows={4}
                placeholder="Add instructions or context for the skill (optional)…"
                value={userContext}
                onChange={e => setUserContext(e.target.value)}
                disabled={loading}
                onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirm();
                    }
                }}
            />
            <div className="mt-2">
                <ModalJobAiControls
                    selection={aiSelection}
                    disabled={loading}
                    testIdPrefix="skill-context"
                />
            </div>
            {error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
            )}
        </Dialog>
    );
}
