/**
 * AmendMessageModal — inline editor modal for amending the HEAD commit message.
 *
 * Pre-populates from the existing commit subject/body, validates that the
 * title is non-empty, and calls onConfirm with the edited title and body.
 */

import { useState, useEffect, useRef } from 'react';
import type { GitCommitItem } from './CommitList';

interface AmendMessageModalProps {
    commit: GitCommitItem;
    onConfirm: (title: string, body: string) => void;
    onCancel: () => void;
}

const TITLE_MAX_SOFT = 72;

export function AmendMessageModal({ commit, onConfirm, onCancel }: AmendMessageModalProps) {
    const [title, setTitle] = useState(() => commit.subject ?? '');
    const [body, setBody] = useState(() => commit.body ?? '');
    const [titleError, setTitleError] = useState<string | null>(null);

    const titleRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        titleRef.current?.focus();
        titleRef.current?.select();
    }, []);

    const handleConfirm = () => {
        if (!title.trim()) {
            setTitleError('Commit title is required.');
            return;
        }
        onConfirm(title.trim(), body);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            onCancel();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/50"
            onKeyDown={handleKeyDown}
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div className="bg-[var(--vscode-editor-background,#1e1e1e)] border border-[var(--vscode-panel-border,#333)] rounded-md shadow-xl w-[480px] max-w-full mx-4 p-5 flex flex-col gap-4">
                <h2 className="text-sm font-semibold text-[var(--vscode-foreground,#ccc)]">Amend Commit Message</h2>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--vscode-descriptionForeground,#999)]">
                        Title{title.length > TITLE_MAX_SOFT && (
                            <span className="ml-2 text-[#f0ad4e]">({title.length} chars — consider keeping under {TITLE_MAX_SOFT})</span>
                        )}
                    </label>
                    <input
                        ref={titleRef}
                        type="text"
                        value={title}
                        onChange={(e) => { setTitle(e.target.value); setTitleError(null); }}
                        className={`w-full px-2 py-1.5 text-sm rounded border bg-[var(--vscode-input-background,#3c3c3c)] text-[var(--vscode-input-foreground,#ccc)] outline-none ${titleError ? 'border-[#f44747]' : 'border-[var(--vscode-input-border,#555)]'} focus:border-[#0078d4]`}
                        placeholder="Commit title"
                    />
                    {titleError && (
                        <span className="text-xs text-[#f44747]">{titleError}</span>
                    )}
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-[var(--vscode-descriptionForeground,#999)]">Body <span className="opacity-60">(optional)</span></label>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={5}
                        className="w-full px-2 py-1.5 text-sm rounded border border-[var(--vscode-input-border,#555)] bg-[var(--vscode-input-background,#3c3c3c)] text-[var(--vscode-input-foreground,#ccc)] outline-none focus:border-[#0078d4] resize-y font-mono"
                        placeholder="Extended description (optional)"
                    />
                </div>

                <div className="flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs rounded border border-[var(--vscode-button-border,#555)] text-[var(--vscode-foreground,#ccc)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground,#2a2d2e)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-3 py-1.5 text-xs rounded bg-[#0078d4] hover:bg-[#1a8ad4] text-white font-medium transition-colors"
                    >
                        Amend
                    </button>
                </div>
            </div>
        </div>
    );
}
