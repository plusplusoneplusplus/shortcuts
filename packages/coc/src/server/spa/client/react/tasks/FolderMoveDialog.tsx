/**
 * FolderMoveDialog — destination picker for the "Move Folder" action.
 * Renders the full folder tree as a flat indented list so the user can
 * choose a destination, then calls onConfirm(destinationRelativePath).
 */

import { useState, useMemo, useCallback } from 'react';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';
import type { TaskFolder } from '../hooks/useTaskTree';

export interface FolderMoveDialogProps {
    open: boolean;
    onClose: () => void;
    sourceFolder: TaskFolder | null;
    tree: TaskFolder;
    onConfirm: (destinationRelativePath: string) => void;
}

export interface DestinationOption {
    label: string;
    relativePath: string;
    depth: number;
}

export function buildDestinations(
    folder: TaskFolder,
    sourceRelativePath: string,
    depth = 0,
    acc: DestinationOption[] = [],
): DestinationOption[] {
    if (folder.relativePath === sourceRelativePath) return acc;

    if (depth > 0) {
        acc.push({ label: folder.name, relativePath: folder.relativePath, depth: depth - 1 });
    }

    for (const child of folder.children) {
        buildDestinations(child, sourceRelativePath, depth + 1, acc);
    }
    return acc;
}

export function FolderMoveDialog({
    open,
    onClose,
    sourceFolder,
    tree,
    onConfirm,
}: FolderMoveDialogProps) {
    const [selected, setSelected] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const options = useMemo<DestinationOption[]>(() => {
        if (!sourceFolder) return [];
        return [
            { label: 'Tasks Root', relativePath: '', depth: 0 },
            ...buildDestinations(tree, sourceFolder.relativePath),
        ];
    }, [tree, sourceFolder]);

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

    if (!sourceFolder) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Move Folder"
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
                    Select destination for <strong>{sourceFolder.name}</strong>:
                </p>
                <div
                    className="max-h-64 overflow-y-auto border border-[#e0e0e0] dark:border-[#3c3c3c] rounded"
                    data-testid="move-destination-list"
                >
                    {options.map((opt) => (
                        <button
                            key={opt.relativePath}
                            type="button"
                            className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                                selected === opt.relativePath
                                    ? 'bg-[#0066b8]/10 dark:bg-[#264f78]/30'
                                    : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            }`}
                            style={{ paddingLeft: `calc(0.75rem + ${opt.depth}rem)` }}
                            onClick={() => { setSelected(opt.relativePath); setError(null); }}
                            data-testid={`move-dest-${opt.relativePath || 'root'}`}
                        >
                            {opt.relativePath ? '📁 ' : '🏠 '}{opt.label}
                        </button>
                    ))}
                </div>
                {error && (
                    <p className="text-xs text-[#f14c4c]" data-testid="move-error">
                        {error}
                    </p>
                )}
            </div>
        </Dialog>
    );
}
