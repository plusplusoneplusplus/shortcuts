import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SentinelRefrain } from '@plusplusoneplusplus/coc-client';
import { Button } from '../../../ui/Button';

export type SaveRefrainInstructions = (instructions: string, expectedRevision: number) => Promise<boolean>;

export function SentinelRefrainInstructions({ job, disabled, onClearError, onSave }: {
    job: SentinelRefrain; disabled: boolean; onClearError: () => void; onSave: SaveRefrainInstructions;
}) {
    const id = useId();
    const [draft, setDraft] = useState<{ instructions: string; revision: number } | null>(null);
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);
    const live = useRef(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const wasEditing = useRef(false);
    const restoreFocus = useRef(false);
    const editing = draft !== null;
    useEffect(() => {
        live.current = true;
        return () => { live.current = false; };
    }, []);
    useLayoutEffect(() => {
        if (editing) inputRef.current?.focus();
        else if (wasEditing.current && restoreFocus.current) rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        wasEditing.current = editing;
    }, [editing]);
    const changed = draft !== null && draft.revision !== job.revision;
    const invalid = draft !== null && (!draft.instructions.trim() || draft.instructions.length > 32_000);
    const blocked = disabled || !!job.activeRun || saving;
    const finishEditing = () => {
        const active = document.activeElement;
        restoreFocus.current = !!rootRef.current?.contains(active) || active === document.body;
        setDraft(null);
    };
    const cancel = () => { if (!pending.current) { finishEditing(); onClearError(); } };
    const save = async () => {
        if (!draft || blocked || changed || invalid || pending.current) return;
        pending.current = true;
        setSaving(true);
        try {
            const saved = await onSave(draft.instructions, draft.revision);
            if (live.current && saved) finishEditing();
        } finally {
            pending.current = false;
            if (live.current) setSaving(false);
        }
    };
    return <div ref={rootRef} className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h5 className="font-semibold">Instructions</h5>
            {!editing && <Button size="sm" variant="secondary" disabled={blocked}
                title={job.activeRun ? 'Wait for the active run to finish' : undefined}
                onClick={() => { onClearError(); setDraft({ instructions: job.instructions, revision: job.revision }); }}>Edit instructions</Button>}
        </div>
        {!draft ? <pre role="region" tabIndex={0} aria-label={`Instructions for ${job.name}`}>{job.instructions}</pre>
            : <form aria-label={`Edit instructions for ${job.name}`} aria-busy={saving}
                className="flex min-w-0 flex-col gap-2" onSubmit={event => { event.preventDefault(); void save(); }}
                onKeyDown={event => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    cancel();
                }}>
                <label htmlFor={`${id}-instructions`}>Instructions for {job.name}</label>
                <textarea ref={inputRef} id={`${id}-instructions`} value={draft.instructions} required maxLength={32_000}
                    rows={8} disabled={blocked} aria-invalid={invalid} aria-describedby={`${id}-help`}
                    className="w-full min-w-0 rounded border border-[#e0e0e0] bg-transparent px-2 py-1 text-xs dark:border-[#3c3c3c]"
                    onChange={event => setDraft({ ...draft, instructions: event.target.value })} />
                <p id={`${id}-help`} role={changed || invalid ? 'alert' : undefined}>
                    {changed ? 'This Refrain changed. Cancel and edit again to review the saved instructions. Your draft is preserved.'
                        : invalid ? 'Enter instructions (up to 32,000 characters).'
                            : job.activeRun ? 'Wait for the active run to finish before saving instructions.'
                                : 'Only instructions are saved. The schedule and other settings stay unchanged.'}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="secondary" disabled={saving} onClick={cancel}>Cancel instructions edit</Button>
                    <Button size="sm" type="submit" disabled={blocked || changed || invalid}>{saving ? 'Saving instructions...' : 'Save instructions'}</Button>
                </div>
            </form>}
    </div>;
}
