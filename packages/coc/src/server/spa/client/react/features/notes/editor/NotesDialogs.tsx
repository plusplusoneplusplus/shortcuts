import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog } from '../../../ui/Dialog';
import { Button } from '../../../ui/Button';
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
    onAICreateNote?: (prompt: string) => Promise<void>;
    setSubmitting: (submitting: boolean) => void;
}

export function NotesDialogs({
    dialog,
    onClose,
    onCreateNode,
    onRenameNode,
    onDeleteNode,
    onAICreateNote,
    setSubmitting,
}: NotesDialogsProps) {
    if (!dialog) return null;

    const { action, node } = dialog;

    if (action === 'create-page-ai') {
        return (
            <AICreateNoteDialog
                submitting={dialog.submitting}
                onClose={onClose}
                onConfirm={async (prompt: string) => {
                    setSubmitting(true);
                    try {
                        await onAICreateNote?.(prompt);
                        onClose();
                    } catch {
                        setSubmitting(false);
                    }
                }}
            />
        );
    }

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

/* ── Add Comment Dialog ──────────────────────────────────────────────── */

const MAX_QUOTE_DISPLAY = 120;

export interface AddCommentDialogProps {
    open: boolean;
    quotedText: string;
    onConfirm: (text: string) => void;
    onClose: () => void;
}

export function AddCommentDialog({ open, quotedText, onConfirm, onClose }: AddCommentDialogProps) {
    const [text, setText] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Reset text whenever the dialog opens
    useEffect(() => {
        if (open) {
            setText('');
            // Defer focus so the dialog is fully mounted in the DOM
            setTimeout(() => textareaRef.current?.focus(), 0);
        }
    }, [open]);

    const trimmed = text.trim();
    const isValid = trimmed.length > 0;

    const handleConfirm = useCallback(() => {
        if (isValid) onConfirm(trimmed);
    }, [isValid, trimmed, onConfirm]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleConfirm();
            }
        },
        [handleConfirm],
    );

    const displayQuote =
        quotedText.length > MAX_QUOTE_DISPLAY
            ? quotedText.slice(0, MAX_QUOTE_DISPLAY) + '…'
            : quotedText;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title="Add Comment"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} data-testid="add-comment-dialog-cancel">
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        disabled={!isValid}
                        onClick={handleConfirm}
                        data-testid="add-comment-dialog-confirm"
                    >
                        Add
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-3">
                {displayQuote && (
                    <div
                        className="text-xs italic text-[#666] dark:text-[#999] border-l-2 border-[#0078d4] pl-2 py-0.5 truncate"
                        data-testid="add-comment-dialog-quote"
                        title={quotedText}
                    >
                        {displayQuote}
                    </div>
                )}
                <textarea
                    ref={textareaRef}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-none"
                    rows={4}
                    placeholder="Add a comment…"
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    data-testid="add-comment-dialog-textarea"
                />
            </div>
        </Dialog>
    );
}

/* ── AI Create Note Dialog ───────────────────────────────────────────── */

interface AICreateNoteDialogProps {
    submitting: boolean;
    onClose: () => void;
    onConfirm: (prompt: string) => void;
}

function AICreateNoteDialog({ submitting, onClose, onConfirm }: AICreateNoteDialogProps) {
    const [prompt, setPrompt] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setTimeout(() => textareaRef.current?.focus(), 0);
    }, []);

    const trimmed = prompt.trim();
    const isValid = trimmed.length > 0;

    const handleConfirm = useCallback(() => {
        if (isValid) onConfirm(trimmed);
    }, [isValid, trimmed, onConfirm]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
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
            title="Create Note with AI"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        loading={submitting}
                        disabled={!isValid}
                        onClick={handleConfirm}
                        data-testid="ai-create-note-confirm"
                    >
                        Create
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-2">
                <label className="text-xs text-[#616161] dark:text-[#999]">
                    What would you like to write about?
                </label>
                <textarea
                    ref={textareaRef}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-none"
                    rows={3}
                    placeholder="e.g., Meeting notes about the Q4 roadmap discussion"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    data-testid="ai-create-note-textarea"
                />
                <span className="text-xs text-[#848484] dark:text-[#666] italic">
                    AI will create a note with a title and place it in the best notebook.
                </span>
            </div>
        </Dialog>
    );
}
