import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';

export interface RenameDialogProps {
    open: boolean;
    currentTitle: string;
    onConfirm: (newTitle: string) => void;
    onCancel: () => void;
}

const TITLE_MAX = 80;

export function RenameDialog({ open, currentTitle, onConfirm, onCancel }: RenameDialogProps) {
    const [title, setTitle] = useState(currentTitle);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setTitle(currentTitle);
            setError('');
            // Auto-focus + select-all after portal mounts
            requestAnimationFrame(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            });
        }
    }, [open, currentTitle]);

    const handleConfirm = useCallback(() => {
        const trimmed = title.trim();
        if (!trimmed) { setError('Title is required'); return; }
        if (trimmed.length > TITLE_MAX) { setError(`Title must be ${TITLE_MAX} characters or less`); return; }
        onConfirm(trimmed);
    }, [title, onConfirm]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); }
    }, [handleConfirm]);

    return (
        <Dialog
            id="rename-chat-dialog"
            open={open}
            onClose={onCancel}
            title="Rename Chat"
            footer={
                <>
                    <Button variant="secondary" id="rename-cancel-btn" onClick={onCancel}>Cancel</Button>
                    <Button id="rename-confirm-btn" onClick={handleConfirm}>Rename</Button>
                </>
            }
        >
            <div className="space-y-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={title}
                    onChange={e => { setTitle(e.target.value); setError(''); }}
                    onKeyDown={handleKeyDown}
                    maxLength={TITLE_MAX}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[var(--vscode-foreground,#1e1e1e)] outline-none focus:border-[#0078d4]"
                    placeholder="Chat title"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore="true"
                />
                {error && <p className="text-xs text-[#f14c4c]">{error}</p>}
            </div>
        </Dialog>
    );
}
