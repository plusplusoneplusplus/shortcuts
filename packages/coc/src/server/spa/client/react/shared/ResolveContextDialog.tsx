/**
 * ResolveContextDialog — modal dialog shown before AI resolve operations.
 *
 * Lets the user provide additional context and select skills via slash commands
 * before resolving comments with AI. Integrates RichTextInput with
 * useSlashCommands for `/skill` autocomplete.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Dialog } from './Dialog';
import { RichTextInput, type RichTextInputHandle } from './RichTextInput';
import { useSlashCommands } from '../features/chat/hooks/useSlashCommands';
import { SlashCommandMenu, type SkillItem } from '../features/chat/SlashCommandMenu';
import { fetchApi } from '../hooks/useApi';

const SESSION_KEY = 'coc:skipResolveDialog';

export interface ResolveContextDialogProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (context: string, skills: string[]) => void;
    commentCount: number;
    title?: string;
    wsId: string;
}

export function ResolveContextDialog({
    open,
    onClose,
    onSubmit,
    commentCount,
    title = 'Resolve with AI',
    wsId,
}: ResolveContextDialogProps) {
    const [text, setText] = useState('');
    const [dontAskAgain, setDontAskAgain] = useState(false);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const inputRef = useRef<RichTextInputHandle>(null);

    // Fetch skills
    useEffect(() => {
        if (!open || !wsId) return;
        const controller = new AbortController();
        fetchApi('/workspaces/' + encodeURIComponent(wsId) + '/skills/all', { signal: controller.signal })
            .then((data: any) => {
                setSkills(data?.merged ?? data?.skills ?? []);
            })
            .catch(() => { /* ignore */ });
        return () => controller.abort();
    }, [open, wsId]);

    // Focus input when dialog opens
    useEffect(() => {
        if (open) {
            setText('');
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    const slashCommands = useSlashCommands(skills);

    const handleInputChange = useCallback(
        (val: string, cursorPos: number) => {
            setText(val);
            slashCommands.handleInputChange(val, cursorPos);
        },
        [slashCommands],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (slashCommands.handleKeyDown(e)) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
            }
        },
        [slashCommands, text],
    );

    const handleSelectSkill = useCallback(
        (name: string) => {
            slashCommands.selectSkill(name, text, setText, inputRef as React.RefObject<RichTextInputHandle>);
        },
        [slashCommands, text],
    );

    const handleSubmit = useCallback(() => {
        if (dontAskAgain) {
            try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
        }
        const { skills: parsedSkills, prompt } = slashCommands.parseAndExtract(text);
        onSubmit(prompt, parsedSkills);
    }, [text, dontAskAgain, slashCommands, onSubmit]);

    const footer = (
        <div className="flex items-center justify-between w-full gap-2">
            <label className="flex items-center gap-1.5 text-xs text-[#848484] select-none cursor-pointer">
                <input
                    type="checkbox"
                    checked={dontAskAgain}
                    onChange={e => setDontAskAgain(e.target.checked)}
                    data-testid="resolve-dialog-skip-checkbox"
                    className="accent-blue-500"
                />
                Don&apos;t ask again for this session
            </label>
            <div className="flex gap-2">
                <button
                    onClick={onClose}
                    className="px-3 py-1.5 text-xs rounded border border-[#d1d5db] dark:border-[#555] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    data-testid="resolve-dialog-cancel"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
                    data-testid="resolve-dialog-submit"
                >
                    ▶ Resolve with AI
                </button>
            </div>
        </div>
    );

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={title}
            footer={footer}
            id="resolve-context-dialog"
        >
            <div className="flex flex-col gap-3 p-4 min-w-[340px]">
                <div className="relative">
                    <label className="text-xs text-[#848484] mb-1 block">
                        Additional context (optional)
                    </label>
                    <RichTextInput
                        ref={inputRef}
                        value={text}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Type / for skills..."
                        data-testid="resolve-dialog-input"
                    />
                    <SlashCommandMenu
                        skills={slashCommands.filteredSkills}
                        filter={slashCommands.menuFilter}
                        onSelect={handleSelectSkill}
                        onDismiss={slashCommands.dismissMenu}
                        visible={slashCommands.menuVisible}
                        highlightIndex={slashCommands.highlightIndex}
                    />
                </div>
                <div className="text-xs text-[#848484]" data-testid="resolve-dialog-info">
                    ℹ️ Resolving {commentCount} open comment{commentCount !== 1 ? 's' : ''}
                </div>
            </div>
        </Dialog>
    );
}

/**
 * Check whether the user has opted to skip the resolve dialog for this session.
 */
export function shouldSkipResolveDialog(): boolean {
    try {
        return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * Reset the "don't ask again" preference.
 */
export function resetSkipResolveDialog(): void {
    try {
        sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
}
