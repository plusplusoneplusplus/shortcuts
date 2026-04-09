import { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog } from '../../shared/Dialog';
import { Button } from '../../shared/Button';
import type { NoteDialog } from './useNotesContextMenu';

const INVALID_NAME_CHARS = /[/\\:*?<>|"]/g;

function getInvalidChars(name: string): string[] {
    return [...new Set(name.match(INVALID_NAME_CHARS) ?? [])];
}

export interface NotesDialogsProps {
    dialog: NoteDialog | null;
    onClose: () => void;
    onCreateNode: (parentPath: string, name: string, type: 'notebook' | 'section' | 'page') => Promise<void>;
    onRenameNode: (oldPath: string, newPath: string) => Promise<void>;
    onDeleteNode: (path: string) => Promise<void>;
    setSubmitting: (submitting: boolean) => void;
}

export function NotesDialogs({
    dialog,
    onClose,
    onCreateNode,
    onRenameNode,
    onDeleteNode,
    setSubmitting,
}: NotesDialogsProps) {
    if (!dialog) return null;

    const { action, node } = dialog;

    if (action === 'delete') {
        return (
            <DeleteDialog
                nodeName={node.name}
                submitting={dialog.submitting}
                onClose={onClose}
                onConfirm={async () => {
                    setSubmitting(true);
                    try {
                        await onDeleteNode(node.path);
                        onClose();
                    } catch {
                        setSubmitting(false);
                    }
                }}
            />
        );
    }

    if (action === 'rename') {
        return (
            <InputDialog
                title="Rename"
                label="New name"
                initialValue={node.name}
                placeholder="Enter new name"
                confirmLabel="Rename"
                submitting={dialog.submitting}
                onClose={onClose}
                onConfirm={async (newName: string) => {
                    setSubmitting(true);
                    try {
                        const parentPath = node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
                        const newPath = parentPath ? `${parentPath}/${newName}` : newName;
                        await onRenameNode(node.path, newPath);
                        onClose();
                    } catch {
                        setSubmitting(false);
                    }
                }}
            />
        );
    }

    // create-page, create-section, create-notebook
    const createType = action === 'create-page' ? 'page' : action === 'create-section' ? 'section' : 'notebook';
    const titleMap: Record<string, string> = {
        'create-page': 'Create Page',
        'create-section': 'Create Section',
        'create-notebook': 'Create Notebook',
    };
    const title = titleMap[action] ?? 'Create';

    return (
        <InputDialog
            title={title}
            label="Name"
            initialValue=""
            placeholder={`Enter ${createType} name`}
            confirmLabel="Create"
            submitting={dialog.submitting}
            onClose={onClose}
            onConfirm={async (name: string) => {
                setSubmitting(true);
                try {
                    const parentPath = action === 'create-notebook' ? '' : node.path;
                    await onCreateNode(parentPath, name, createType);
                    onClose();
                } catch {
                    setSubmitting(false);
                }
            }}
        />
    );
}

/* ── Input Dialog ────────────────────────────────────────────────────── */

interface InputDialogProps {
    title: string;
    label: string;
    initialValue: string;
    placeholder: string;
    confirmLabel: string;
    submitting: boolean;
    onClose: () => void;
    onConfirm: (value: string) => void;
}

function InputDialog({
    title,
    label,
    initialValue,
    placeholder,
    confirmLabel,
    submitting,
    onClose,
    onConfirm,
}: InputDialogProps) {
    const [name, setName] = useState(initialValue);

    useEffect(() => {
        setName(initialValue);
    }, [initialValue]);

    const invalidChars = useMemo(() => getInvalidChars(name), [name]);
    const hasInvalidChars = invalidChars.length > 0;
    const trimmed = name.trim();
    const isValid = trimmed.length > 0 && !hasInvalidChars;

    const handleConfirm = useCallback(() => {
        if (isValid) onConfirm(trimmed);
    }, [isValid, trimmed, onConfirm]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
            }
        },
        [handleConfirm],
    );

    return (
        <Dialog
            open
            onClose={onClose}
            title={title}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        loading={submitting}
                        disabled={!isValid}
                        onClick={handleConfirm}
                        data-testid="notes-dialog-confirm"
                    >
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-1">
                <label className="text-xs text-[#616161] dark:text-[#999]">{label}</label>
                <input
                    type="text"
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    autoFocus
                    data-testid="notes-dialog-input"
                />
                {hasInvalidChars && (
                    <span className="text-xs text-red-500 dark:text-red-400" data-testid="notes-dialog-error">
                        Name contains invalid characters: {invalidChars.map(c => `"${c}"`).join(', ')}
                    </span>
                )}
            </div>
        </Dialog>
    );
}

/* ── Delete Confirmation Dialog ──────────────────────────────────────── */

interface DeleteDialogProps {
    nodeName: string;
    submitting: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

function DeleteDialog({ nodeName, submitting, onClose, onConfirm }: DeleteDialogProps) {
    return (
        <Dialog
            open
            onClose={onClose}
            title="Delete"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="danger"
                        loading={submitting}
                        onClick={onConfirm}
                        data-testid="notes-dialog-confirm"
                    >
                        Delete
                    </Button>
                </>
            }
        >
            Are you sure you want to delete <strong>{nodeName}</strong>? This cannot be undone.
        </Dialog>
    );
}
