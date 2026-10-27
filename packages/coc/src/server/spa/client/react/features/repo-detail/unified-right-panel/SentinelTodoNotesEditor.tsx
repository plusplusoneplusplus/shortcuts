import { forwardRef, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import { isMacPlatform } from '../../../utils/composerKeyboardShortcuts';
import { Button } from '../../../ui/Button';
import { cn } from '../../../ui/cn';

function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}
const enabled = () => isFeatureEnabled('sentinelTodoInlineNotesEnabled');
export function useSentinelTodoInlineNotesEnabled() {
    return useSyncExternalStore(subscribeConfig, enabled, enabled);
}

/**
 * Click-to-edit surface around the rendered notes. Links stop propagation in
 * `SentinelTodoNotes`, and a click that ends a text selection never edits.
 */
export function EditableNotesArea({ editable, onEdit, children }: { editable: boolean; onEdit: () => void; children: ReactNode }) {
    if (!editable) return <>{children}</>;
    const click = (event: MouseEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('a[href]')) return;
        const selection = event.currentTarget.ownerDocument.getSelection();
        if (selection && !selection.isCollapsed && selection.rangeCount > 0
            && selection.getRangeAt(0).intersectsNode(event.currentTarget)) return;
        onEdit();
    };
    return <div onClick={click} title="Click to edit notes" data-testid="sentinel-todo-notes-editable"
        className="-mx-1 cursor-text rounded px-1 transition-colors hover:bg-black/[0.04] hover:ring-1 hover:ring-[#0078d4]/30 dark:hover:bg-white/[0.04]">
        {children}
    </div>;
}

/** Link-styled header action shared by Edit notes and Add notes. */
export const NotesActionButton = forwardRef<HTMLButtonElement, { label: string; disabled: boolean; title?: string; onClick: () => void }>(
    ({ label, disabled, title, onClick }, ref) => <button ref={ref} type="button" disabled={disabled} title={title} onClick={onClick}
        className="inline-flex items-center gap-1 rounded text-[#0078d4] hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0078d4] disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50 dark:text-[#3794ff]">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="m10 2 4 4-8 8H2v-4Z M8 4l4 4" />
        </svg>
        {label}
    </button>,
);
NotesActionButton.displayName = 'NotesActionButton';

const ERROR = 'min-w-0 break-words text-[11px] text-[#c72e2e] dark:text-[#f48771]';

/**
 * Inline Notes editor. Saving is explicit (button or Ctrl/Cmd+Enter); blur
 * never saves. `latest` is the newer saved text when notes changed elsewhere
 * after editing began: Save stays off until the user keeps or replaces the draft.
 */
export const SentinelTodoNotesEditor = forwardRef<HTMLTextAreaElement, {
    id: string; itemId: string; value: string; latest: string | null; busy: boolean; error: string | null; archived: boolean;
    onChange: (value: string) => void; onSave: () => void; onCancel: (fromKeyboard: boolean) => void;
    onKeepDraft: () => void; onUseLatest: () => void;
}>(({ id, itemId, value, latest, busy, error, archived, onChange, onSave, onCancel, onKeepDraft, onUseLatest }, ref) => {
    const mod = isMacPlatform() ? '⌘' : 'Ctrl';
    const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
            event.preventDefault(); event.stopPropagation();
            onSave();
        } else if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            onCancel(true);
        }
    };
    const rows = Math.min(20, Math.max(6, value.split('\n').length + 1));
    return <form className="flex min-w-0 flex-col gap-1" aria-label="Edit notes" data-testid={`sentinel-todo-notes-editor-${itemId}`}
        onSubmit={event => { event.preventDefault(); onSave(); }}>
        <label className="sr-only" htmlFor={id}>Notes</label>
        <textarea ref={ref} id={id} value={value} maxLength={8000} rows={rows} readOnly={busy} spellCheck
            aria-describedby={`${id}-hint`} aria-invalid={error ? true : undefined}
            onChange={event => onChange(event.target.value)} onKeyDown={key}
            className={cn('w-full min-w-0 resize-y rounded border border-[#c8c8c8] bg-white px-2 py-1.5 font-[inherit] text-xs leading-relaxed text-[#1e1e1e]',
                'focus:border-[#0078d4] focus:outline-none focus:ring-1 focus:ring-[#0078d4] dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#cccccc]',
                busy && 'opacity-70')} />
        {latest !== null && <div role="alert" data-testid={`sentinel-todo-notes-conflict-${itemId}`}
            className="flex min-w-0 flex-col gap-1 rounded border border-[#b5650f]/40 bg-[#b5650f]/10 px-2 py-1.5 text-[11px] dark:border-[#cca700]/40">
            <span>Notes changed elsewhere while you were editing. Your draft is kept and nothing was overwritten.</span>
            <span className="font-medium">Latest saved notes:</span>
            <div className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-black/[0.04] px-1.5 py-1 [overflow-wrap:anywhere] dark:bg-white/[0.06]"
                data-testid={`sentinel-todo-notes-latest-${itemId}`}>{latest || '(empty)'}</div>
            <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="secondary" disabled={busy} onClick={onKeepDraft}>Keep my draft</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={onUseLatest}>Use latest</Button>
            </div>
        </div>}
        {archived && <span role="alert" className={ERROR}>This To-do is archived, so Notes cannot be saved. Your draft is kept until you cancel.</span>}
        {error && latest === null && <span role="alert" className={ERROR} data-testid={`sentinel-todo-notes-error-${itemId}`}>{error} Your draft is kept.</span>}
        <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" type="submit" disabled={archived || latest !== null} loading={busy}>Save</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onCancel(false)}>Cancel</Button>
            <span id={`${id}-hint`} className="ml-auto text-[11px] text-[#616161] dark:text-[#9d9d9d]">
                {busy ? <span role="status">Saving…</span> : `${mod}+Enter to save · Esc to cancel`}
            </span>
        </div>
    </form>;
});
SentinelTodoNotesEditor.displayName = 'SentinelTodoNotesEditor';
