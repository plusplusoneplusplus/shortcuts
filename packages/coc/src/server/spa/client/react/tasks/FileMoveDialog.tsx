/**
 * FileMoveDialog — destination-folder picker for the "Move File" action.
 * Reuses the buildDestinations helper from FolderMoveDialog to render
 * the full folder tree as a flat indented list.
 */

import { useState, useMemo, useCallback } from 'react';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';
import type { TaskFolder } from '../hooks/useTaskTree';
import { buildDestinations } from './FolderMoveDialog';

export interface FileMoveDialogProps {
    open: boolean;
    onClose: () => void;
    /** Display name of the file/group being moved. */
    sourceName: string | null;
    tree: TaskFolder;
    onConfirm: (destinationRelativePath: string) => Promise<void>;
}

export function FileMoveDialog({
    open,
    onClose,
    sourceName,
    tree,
    onConfirm,
}: FileMoveDialogProps) {
    const [selected, setSelected] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Show all folders (no exclusion — use a sentinel that won't match anything)
    const options = useMemo(() => [
        { label: 'Tasks Root', relativePath: '', depth: 0 },
        ...buildDestinations(tree, '\0'),
    ], [tree]);

    const handleConfirm = useCallback(async () => {
        setError(null);
        setSubmitting(true);
        try {
            await onConfirm(selected);
        } catch (err: any) {
            setError(err.message || 'Move failed');
            setSubmitting(false);
        }
    }, [selected, onConfirm]);

    if (!sourceName) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Move File"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        loading={submitting}
                        onClick={handleConfirm}
                    >
                        Move
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-2">
                <p className="text-xs text-[#616161] dark:text-[#999]">
                    Select destination for <strong>{sourceName}</strong>:
                </p>
                <div
                    className="max-h-64 overflow-y-auto border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
                    data-testid="file-move-destination-list"
                >
                    {options.map((opt) => (
                        <button
                            key={opt.relativePath || '__root__'}
                            type="button"
                            className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                                selected === opt.relativePath
                                    ? 'bg-[#0066b8]/10 dark:bg-[#264f78]/30'
                                    : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            }`}
                            style={{ paddingLeft: `calc(0.75rem + ${opt.depth}rem)` }}
                            onClick={() => { setSelected(opt.relativePath); setError(null); }}
                            data-testid={`file-move-dest-${opt.relativePath || 'root'}`}
                        >
                            {opt.relativePath ? '📁 ' : '🏠 '}{opt.label}
                        </button>
                    ))}
                </div>
                {error && (
                    <p className="text-xs text-[#f14c4c]" data-testid="file-move-error">
                        {error}
                    </p>
                )}
            </div>
        </Dialog>
    );
}
