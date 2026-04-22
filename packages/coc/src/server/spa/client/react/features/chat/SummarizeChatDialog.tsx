import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui';

export interface SummarizeChatDialogProps {
    open: boolean;
    chatCount: number;
    onClose: () => void;
    onConfirm: (userPrompt: string) => Promise<void>;
}

export function SummarizeChatDialog({ open, chatCount, onClose, onConfirm }: SummarizeChatDialogProps) {
    const [userPrompt, setUserPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setUserPrompt('');
            setLoading(false);
            setError(null);
        }
    }, [open]);

    const handleConfirm = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            await onConfirm(userPrompt.trim());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to summarize');
        } finally {
            setLoading(false);
        }
    }, [onConfirm, userPrompt]);

    const subtitle = chatCount === 1
        ? 'Summarizing 1 conversation'
        : `Summarizing ${chatCount} conversations`;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Summarize chats"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleConfirm} disabled={loading}>
                        {loading ? 'Summarizing…' : 'Summarize'}
                    </Button>
                </>
            }
        >
            <p className="text-xs text-[#848484] dark:text-[#999] mb-2">{subtitle}</p>
            <textarea
                className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] p-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                rows={4}
                placeholder="Optional: add a question or focus area for the summary…"
                value={userPrompt}
                onChange={e => setUserPrompt(e.target.value)}
                disabled={loading}
                onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirm();
                    }
                }}
            />
            {error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>
            )}
        </Dialog>
    );
}
