/**
 * FolderActionDialog — reusable dialog wrapping Dialog + controlled input
 * for folder name-prompt actions (Rename, Create Subfolder, Create Task).
 */

import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';

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
    /** Set to true while the async mutation is in flight — disables the confirm button and shows a spinner. */
    submitting?: boolean;
    /** Called when the user clicks Cancel or presses Escape. */
    onClose: () => void;
    /** Called with the trimmed input value when the user confirms. Empty string is not submitted. */
    onConfirm: (name: string) => void;
}

export function FolderActionDialog({
    open,
    title,
    label,
    initialValue,
    placeholder,
    confirmLabel,
    submitting,
    onClose,
    onConfirm,
}: FolderActionDialogProps) {
    const [name, setName] = useState(initialValue);

    // Reset input when dialog opens
    useEffect(() => {
        if (open) setName(initialValue);
    }, [open, initialValue]);

    const handleConfirm = useCallback(() => {
        const trimmed = name.trim();
        if (trimmed) onConfirm(trimmed);
    }, [name, onConfirm]);

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
            open={open}
            onClose={onClose}
            title={title}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        loading={submitting}
                        disabled={!name.trim()}
                        onClick={handleConfirm}
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
                    data-testid="folder-action-input"
                />
            </div>
        </Dialog>
    );
}
