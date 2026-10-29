import { useEffect, useId, useRef, type RefObject } from 'react';
import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

export interface SentinelTodoMessageDialogProps {
    owner: SentinelTodoOwner;
    item: Pick<SentinelTodoItem, 'id' | 'title'>;
    sentinelName: string;
    workspaceLabel: string;
    serverLabel: string;
    text: string;
    onTextChange: (text: string) => void;
    /** The controller enables admission only after validating the captured owner/context. */
    ready: boolean;
    loading?: boolean;
    pending?: boolean;
    error?: string | null;
    onQueue: () => void;
    onClose: () => void;
    duplicateConfirmation?: { onConfirm: () => void; onCancel: () => void };
    returnFocusRef?: RefObject<HTMLElement | null>;
}

/** In-memory composer surface; its caller owns validation, admission and draft lifetime. */
export function SentinelTodoMessageDialog({
    owner, item, sentinelName, workspaceLabel, serverLabel, text, onTextChange,
    ready, loading = false, pending = false, error, onQueue, onClose, returnFocusRef, duplicateConfirmation,
}: SentinelTodoMessageDialogProps) {
    const id = useId();
    const errorRef = useRef<HTMLParagraphElement>(null);
    const confirmationRef = useRef<HTMLDivElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);
    useEffect(() => {
        if (duplicateConfirmation) confirmationRef.current?.focus();
        else if (pending) statusRef.current?.focus();
        else if (error) errorRef.current?.focus();
    }, [error, pending, !!duplicateConfirmation]);
    const close = () => { if (!pending) onClose(); };
    return <Dialog open title="Message Sentinel" trapFocus returnFocusRef={returnFocusRef}
        onClose={close} onMinimize={() => {}} disableClose={pending}
        className="max-w-[min(30rem,calc(100vw-2rem))] rounded-xl"
        renderHeader={() => <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Message Sentinel</h2>}
        footer={<>
            <Button variant="secondary" disabled={pending} onClick={close}>Cancel</Button>
            <Button aria-label="Queue message" disabled={!ready || loading || !!duplicateConfirmation || !text.trim()} loading={pending}
                onClick={() => { if (ready && !loading && !pending && !duplicateConfirmation && text.trim()) onQueue(); }}>Queue message</Button>
        </>}>
        <div className="flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]">
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]">
                <dt>To</dt><dd>{sentinelName} <span className="text-[#848484]">({owner.processId})</span></dd>
                <dt>Workspace</dt><dd>{workspaceLabel} <span className="text-[#848484]">({owner.ownerWorkspaceId})</span></dd>
                <dt>Server</dt><dd>{serverLabel}</dd>
                <dt>Attached To-do</dt><dd>{item.id} · {item.title}</dd>
            </dl>
            <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={`${id}-message`} className="font-medium">Message</label>
                <textarea id={`${id}-message`} data-dialog-initial-focus rows={6} value={text} disabled={pending}
                    aria-describedby={`${id}-status${error ? ` ${id}-error` : ''}`}
                    onChange={event => { if (!pending) onTextChange(event.target.value); }}
                    className="min-w-0 w-full resize-y rounded-lg border border-[#c8c8c8] bg-transparent p-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/60 disabled:opacity-60 dark:border-[#555555]" />
            </div>
            <p ref={statusRef} id={`${id}-status`} role="status" tabIndex={pending ? 0 : -1}
                className="text-xs text-[#848484] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/60">
                {pending ? 'Queueing message…' : loading ? 'Loading attached To-do…'
                    : 'The To-do stays attached. Your message joins the Sentinel’s normal queue.'}
            </p>
            {duplicateConfirmation && <div ref={confirmationRef} tabIndex={-1} role="group" aria-label="Confirm duplicate-risk retry"
                className="flex flex-col gap-3 rounded-lg border border-[#c8c8c8] p-3 text-xs dark:border-[#555555]">
                <p>Delivery is unconfirmed. Retrying may queue a duplicate. Queue this message again?</p>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={pending} onClick={duplicateConfirmation.onCancel}>Keep editing</Button>
                    <Button disabled={pending || !ready || loading || !text.trim()} onClick={duplicateConfirmation.onConfirm}>Queue again anyway</Button>
                </div>
            </div>}
            {error && <p ref={errorRef} id={`${id}-error`} role="alert" tabIndex={-1}
                className="rounded-lg border border-[#f14c4c]/40 p-3 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/60">{error}</p>}
        </div>
    </Dialog>;
}
