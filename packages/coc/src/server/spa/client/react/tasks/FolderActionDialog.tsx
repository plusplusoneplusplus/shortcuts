/**
 * FolderActionDialog — reusable dialog wrapping Dialog + controlled input
 * for folder name-prompt actions (Rename, Create Subfolder, Create Task).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';

const DOC_TYPES = ['', 'plan', 'spec', 'test', 'notes', 'todo', 'design', 'impl', 'review'] as const;

/** Characters that are invalid in file/folder names across all platforms.
 *  Double quotes are intentionally excluded — they are sanitized to single quotes by the backend. */
const INVALID_NAME_CHARS = /[/\\:*?<>|]/g;

function getInvalidChars(name: string): string[] {
    return [...new Set(name.match(INVALID_NAME_CHARS) ?? [])];
}

export interface FolderActionDialogProps {
    /** Controls Dialog visibility. */
    open: boolean;
    /** Dialog title shown in the header, e.g. "Rename Folder". */
    title: string;
    /** Label rendered above the input, e.g. "New name". */
    label: string;
    /** Pre-filled value of the input (empty string for Create actions). */
    initialValue: string;
    /** Placeholder text for the input. */
    placeholder?: string;
    /** Text on the confirm button, e.g. "Rename", "Create". */
    confirmLabel: string;
    /** When true, show docType dropdown (for Create Task). */
    showDocType?: boolean;
    /** Set to true while the async mutation is in flight — disables the confirm button and shows a spinner. */
    submitting?: boolean;
    /** Called when the user clicks Cancel or presses Escape. */
    onClose: () => void;
    /** Called with the trimmed input value when the user confirms. When showDocType is true, called with (name, docType). */
    onConfirm: (name: string, docType?: string) => void;
}

export function FolderActionDialog({
    open,
    title,
    label,
    initialValue,
    placeholder,
    confirmLabel,
    showDocType,
    submitting,
    onClose,
    onConfirm,
}: FolderActionDialogProps) {
    const [name, setName] = useState(initialValue);
    const [docType, setDocType] = useState('');

    const invalidChars = useMemo(() => getInvalidChars(name), [name]);
    const hasInvalidChars = invalidChars.length > 0;

    // Reset input when dialog opens
    useEffect(() => {
        if (open) {
            setName(initialValue);
            setDocType('');
        }
    }, [open, initialValue]);

    const handleConfirm = useCallback(() => {
        const trimmed = name.trim();
        if (trimmed && !hasInvalidChars) onConfirm(trimmed, showDocType ? docType || undefined : undefined);
    }, [name, docType, showDocType, onConfirm, hasInvalidChars]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
            }
        },
        [handleConfirm]
    );

    return (
        <Dialog
            id="task-input-dialog-overlay"
            open={open}
            onClose={onClose}
            title={title}
            footer={
                <form id="task-dialog-form" data-testid="task-dialog-form" onSubmit={e => { e.preventDefault(); handleConfirm(); }}>
                    <Button variant="secondary" type="button" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        type="submit"
                        loading={submitting}
                        disabled={!name.trim() || hasInvalidChars}
                        onClick={e => { e.preventDefault(); handleConfirm(); }}
                    >
                        {confirmLabel}
                    </Button>
                </form>
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
                    data-testid="folder-action-input"
                />
                {hasInvalidChars && (
                    <span className="text-xs text-red-500 dark:text-red-400" data-testid="folder-action-error">
                        Name contains invalid characters: {invalidChars.map(c => `"${c}"`).join(', ')}
                    </span>
                )}
                {showDocType && (
                    <>
                        <label className="text-xs text-[#616161] dark:text-[#999] mt-1">Document type</label>
                        <select
                            id="task-dialog-doctype"
                            data-testid="task-dialog-doctype"
                            className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                            value={docType}
                            onChange={e => setDocType(e.target.value)}
                        >
                            <option value="">(none)</option>
                            {DOC_TYPES.filter(Boolean).map(dt => (
                                <option key={dt} value={dt}>{dt}</option>
                            ))}
                        </select>
                    </>
                )}
            </div>
        </Dialog>
    );
}
