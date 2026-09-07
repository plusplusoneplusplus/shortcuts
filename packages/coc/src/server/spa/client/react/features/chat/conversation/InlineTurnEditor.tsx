import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../../ui/cn';
import { AttachmentPreviews } from '../../../ui/AttachmentPreviews';
import { RichTextInput } from '../../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../../shared/RichTextInput';
import { SlashCommandMenu } from '../SlashCommandMenu';
import type { SkillItem } from '../SlashCommandMenu';
import { RepoMentionMenu } from '../RepoMentionMenu';
import { FileMentionMenu } from '../FileMentionMenu';
import { useSlashCommands } from '../hooks/useSlashCommands';
import { useRepoMentions } from '../hooks/useRepoMentions';
import { useFileMentions } from '../hooks/useFileMentions';
import { useFileMentionRepos } from '../hooks/useFileMentionRepos';
import { useFileAttachments } from '../hooks/useFileAttachments';
import { rewindImagesToAttachments } from '../utils/rewindImages';
import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import { useRepoGroupMembers } from '../../../repos/useRepoGroupMembers';
import { useResolveCloneBaseUrl } from '../../../repos/cloneRouting';
import type { ChatAttachment } from '../../../types/attachments';

export interface InlineTurnEditorSubmission {
    /** Edited message text, read from the live editor. */
    text: string;
    /** Attachments still present in the editor (prefilled images minus removals, plus new ones). */
    attachments: ChatAttachment[];
}

export interface InlineTurnEditorProps {
    /** Original turn text, used to prefill the editor. */
    initialText: string;
    /** Original turn images (base64 data URLs) restored as removable chips. */
    initialImages?: string[];
    /** Workspace the chat belongs to — drives `@file` and `#repo` mention sources. */
    workspaceId?: string;
    /** Skills offered by the `/` menu; same list the main composer uses. */
    skills?: SkillItem[];
    /** True between "Save & Send" and the end of the rewind+send round trip. */
    pending?: boolean;
    /** Inline error shown under the buttons (rewind rejected, send failed, …). */
    error?: string | null;
    /** Discard the edit and return the bubble to its rendered form. */
    onCancel: () => void;
    /** Commit the edit: the caller rewinds to this turn and resends the payload. */
    onSubmit: (submission: InlineTurnEditorSubmission) => void;
}

/**
 * The in-bubble editor for "Edit message".
 *
 * It is a scaled-down `FollowUpInputArea`: the same `RichTextInput` plus the
 * same `/`, `#repo` and `@file` popups and the same attachment hook, minus the
 * composer toolbar (mode / model / effort), because saving reuses the chat's
 * current send settings rather than the original turn's.
 *
 * The component owns only draft state. It never calls the API: "Save & Send"
 * hands the edited text and attachments to `onSubmit`, and the caller decides
 * that this means "rewind to this turn, then send".
 */
export function InlineTurnEditor({
    initialText,
    initialImages,
    workspaceId,
    skills,
    pending = false,
    error,
    onCancel,
    onSubmit,
}: InlineTurnEditorProps) {
    const [text, setText] = useState(initialText);
    const richTextRef = useRef<RichTextInputHandle>(null);
    const skillList = skills ?? [];

    const { attachments, addFromPaste, addFromFileInput, removeAttachment, restoreAttachments, error: attachmentError, clearError } =
        useFileAttachments();

    // Prefill the image chips once, on mount. Only images survive on a turn —
    // other attachment kinds were never persisted, so there is nothing to
    // restore for them (the user can attach fresh ones).
    const prefilledRef = useRef(false);
    useEffect(() => {
        if (prefilledRef.current) return;
        prefilledRef.current = true;
        const restored = rewindImagesToAttachments(initialImages);
        if (restored.length > 0) restoreAttachments(restored);
    }, [initialImages, restoreAttachments]);

    useEffect(() => {
        richTextRef.current?.focus();
    }, []);

    // Mention sources mirror the main composer: `#repo` only inside a repo
    // group, `@file` across every repo the chat can see.
    const repoMentionsEnabled = isRepoGroupWorkspaceId(workspaceId);
    const repoMentionBaseUrl = useResolveCloneBaseUrl()(workspaceId);
    const repoGroupMembers = useRepoGroupMembers(workspaceId ?? '', repoMentionBaseUrl, repoMentionsEnabled);
    const repoMentions = useRepoMentions(repoGroupMembers, repoMentionsEnabled);
    const fileMentionRepos = useFileMentionRepos(workspaceId, repoGroupMembers);
    const fileMentions = useFileMentions(fileMentionRepos, !pending);
    const slashCommands = useSlashCommands(skillList);

    const submit = useCallback(() => {
        if (pending) return;
        const value = richTextRef.current?.getValue() ?? text;
        onSubmit({ text: value, attachments });
    }, [pending, text, attachments, onSubmit]);

    function handleChange(val: string, cursorPos: number) {
        setText(val);
        slashCommands.handleInputChange(val, cursorPos);
        repoMentions.handleInputChange(val, cursorPos);
        fileMentions.handleInputChange(val, cursorPos);
    }

    // Key priority mirrors the composer: every open popup gets first refusal on
    // Enter/Tab/Escape, so those keys never reach save/cancel while a menu is up.
    function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
        if (slashCommands.handleKeyDown(e)) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                const skill = slashCommands.filteredSkills[slashCommands.highlightIndex];
                if (skill) slashCommands.selectSkill(skill.name, text, setText, richTextRef);
            }
            return;
        }
        if (repoMentions.handleKeyDown(e)) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                const member = repoMentions.filteredMembers[repoMentions.highlightIndex];
                if (member?.name) repoMentions.selectMember(member.name, text, setText, richTextRef);
            }
            return;
        }
        if (fileMentions.handleKeyDown(e)) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                const result = fileMentions.results[fileMentions.highlightIndex];
                if (result) fileMentions.selectResult(result, text, setText, richTextRef);
            }
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    }

    const fileInputRef = useRef<HTMLInputElement>(null);
    const inlineError = error ?? attachmentError;

    return (
        <div
            className="relative rounded-lg border border-[#0078d4] dark:border-[#4fc1ff] bg-white dark:bg-[#1f1f1f] p-2"
            data-testid="inline-turn-editor"
        >
            <RichTextInput
                ref={richTextRef}
                value={text}
                pillPaths
                disabled={pending}
                ghostText={fileMentions.menuVisible ? undefined : (slashCommands.activeCommandHint ?? undefined)}
                placeholder="Edit your message…"
                className="w-full min-h-[32px] max-h-60 overflow-y-auto border-transparent bg-transparent px-1 py-1 text-[13px] focus:ring-transparent"
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onPaste={(e: React.ClipboardEvent) => { clearError(); addFromPaste(e); }}
                data-testid="inline-turn-editor-input"
            />
            <AttachmentPreviews
                attachments={attachments}
                onRemove={removeAttachment}
                data-testid="inline-turn-editor-attachments"
            />
            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    className="rounded bg-[#0078d4] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#106ebe] disabled:opacity-60 disabled:cursor-not-allowed"
                    onClick={submit}
                    disabled={pending}
                    data-testid="inline-turn-editor-save"
                >
                    {pending ? 'Sending…' : 'Save & Send'}
                </button>
                <button
                    type="button"
                    className="rounded border border-[#d0d0d0] dark:border-[#3c3c3c] px-2 py-1 text-[11px] text-[#5a5a5a] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] disabled:opacity-60 disabled:cursor-not-allowed"
                    onClick={onCancel}
                    disabled={pending}
                    data-testid="inline-turn-editor-cancel"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    className="rounded px-1.5 py-1 text-[11px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Attach files"
                    aria-label="Attach files"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={pending}
                    data-testid="inline-turn-editor-attach"
                >
                    📎
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    data-testid="inline-turn-editor-file-input"
                    onChange={(e) => {
                        if (e.target.files) addFromFileInput(e.target.files);
                        e.target.value = '';
                    }}
                />
                <span className="ml-auto text-[10px] text-[#848484]">Enter to send · Esc to cancel</span>
            </div>
            {inlineError && (
                <div
                    className={cn('mt-1.5 text-[11px] text-[#f14c4c]')}
                    role="alert"
                    data-testid="inline-turn-editor-error"
                >
                    {inlineError}
                </div>
            )}
            <SlashCommandMenu
                skills={skillList}
                filter={slashCommands.menuFilter}
                onSelect={(name) => { slashCommands.selectSkill(name, text, setText, richTextRef); richTextRef.current?.focus(); }}
                onDismiss={slashCommands.dismissMenu}
                visible={slashCommands.menuVisible}
                highlightIndex={slashCommands.highlightIndex}
            />
            <RepoMentionMenu
                members={repoMentions.filteredMembers}
                onSelect={(name) => { repoMentions.selectMember(name, text, setText, richTextRef); richTextRef.current?.focus(); }}
                onDismiss={repoMentions.dismissMenu}
                visible={repoMentions.menuVisible}
                highlightIndex={repoMentions.highlightIndex}
            />
            <FileMentionMenu
                results={fileMentions.results}
                onSelect={(result) => { fileMentions.selectResult(result, text, setText, richTextRef); richTextRef.current?.focus(); }}
                onDismiss={fileMentions.dismissMenu}
                visible={fileMentions.menuVisible}
                highlightIndex={fileMentions.highlightIndex}
            />
        </div>
    );
}
