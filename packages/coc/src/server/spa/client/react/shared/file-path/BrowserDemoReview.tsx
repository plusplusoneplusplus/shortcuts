import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { Dialog } from '../../ui/Dialog';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import type { BrowserDemoSnapshot } from './browser-bridge';
import { listBrowserDemos, runBrowserDemoCommand, subscribeBrowserDemos } from './browser-demo';
import {
    BROWSER_DEMO_EXAMPLE_MAX, BROWSER_DEMO_MESSAGE_MAX, BROWSER_DEMO_NOTE_MAX, browserDemoAcceptsExample, browserDemoMessageContent,
    browserDemoTabRef, buildBrowserDemoAttachment, clearBrowserDemoEdits, describeBrowserDemoStep, getBrowserDemoEdits, looksLikeSecret,
    setBrowserDemoEdits, type BrowserDemoEdits,
} from './browser-demo-review';

export interface BrowserDemoReviewProps {
    demoId: string;
    /** Client routed to the demo owner's server; used only by Send. */
    client: CocClient;
    onClose: () => void;
}

function toDataUrl(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return `data:text/markdown;base64,${btoa(binary)}`;
}

const button = 'rounded-lg border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50 disabled:cursor-default';
const field = 'w-full rounded border border-[#c8c8c8] bg-transparent px-2 py-1 dark:border-[#555]';

/**
 * Review a stopped demo before anything leaves this window: remove steps, add notes and
 * made-up example values, preview the exact attachment, then Send it to the owning chat
 * or Discard it. Only Send talks to a server.
 */
export function BrowserDemoReview({ demoId, client, onClose }: BrowserDemoReviewProps) {
    const titleId = useId();
    const state = useSyncExternalStore(subscribeBrowserDemos,
        useCallback(() => listBrowserDemos().find(item => item.id === demoId) ?? null, [demoId]), () => null);
    const [draft, setDraft] = useState<BrowserDemoSnapshot | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [edits, setEditsState] = useState<BrowserDemoEdits>(() => getBrowserDemoEdits(demoId));
    const [preview, setPreview] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    const load = useCallback(() => {
        setLoadError(null);
        void runBrowserDemoCommand({ action: 'draft', id: demoId }).then(result => {
            if (!mounted.current) return;
            if (result.ok && result.draft) setDraft(result.draft);
            else setLoadError(result.ok ? 'Could not load the demo.' : result.message);
        });
    }, [demoId]);
    useEffect(load, [load]);

    // The review only exists for a stopped draft: closing follows Discard elsewhere or Resume.
    useEffect(() => {
        if (!state || state.status !== 'stopped') onClose();
    }, [state, onClose]);

    const update = (change: (value: BrowserDemoEdits) => BrowserDemoEdits) => {
        setEditsState(previous => {
            const next = change(previous);
            setBrowserDemoEdits(demoId, next);
            return next;
        });
        setError(null);
    };

    const attachment = useMemo(() => draft ? buildBrowserDemoAttachment(draft, edits) : null, [draft, edits]);
    const secret = Boolean(attachment?.secretSteps.length);
    const canSend = Boolean(attachment && attachment.stepCount > 0 && !secret && !pending);

    const send = async () => {
        if (!draft || !attachment || !canSend) return;
        setPending(true);
        setError(null);
        try {
            await client.processes.sendMessage(draft.owner.processId, {
                content: browserDemoMessageContent(edits, attachment),
                deliveryMode: 'enqueue',
                attachments: [{ name: attachment.name, mimeType: 'text/markdown', size: new TextEncoder().encode(attachment.markdown).length,
                    dataUrl: toDataUrl(attachment.markdown) }],
            }, { workspace: draft.owner.workspaceId });
        } catch (failure) {
            if (mounted.current) {
                setError(`${getSpaCocClientErrorMessage(failure, 'Could not send the demo.')} The demo is kept; try again or discard it.`);
                setPending(false);
            }
            return;
        }
        clearBrowserDemoEdits(demoId);
        await runBrowserDemoCommand({ action: 'sent', id: demoId });
        if (mounted.current) setPending(false);
        onClose();
    };

    const discard = async () => {
        setPending(true);
        const result = await runBrowserDemoCommand({ action: 'discard', id: demoId });
        if (!mounted.current) return;
        setPending(false);
        if (result.ok || result.reason === 'not-found') {
            clearBrowserDemoEdits(demoId);
            onClose();
        } else {
            setError(result.message);
        }
    };

    const resume = async () => {
        setPending(true);
        const result = await runBrowserDemoCommand({ action: 'resume', id: demoId });
        if (!mounted.current) return;
        setPending(false);
        if (!result.ok) setError(result.message);
    };

    const removed = new Set(edits.removed);
    return <Dialog open onClose={onClose} renderHeader={() => null} dense className="max-w-[760px]">
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-native-view-overlay data-testid="browser-demo-review"
            className="flex min-h-0 flex-col gap-3 text-sm">
            <div className="flex items-center gap-2">
                <h2 id={titleId} className="flex-1 text-base font-semibold">{preview ? 'Send demo to chat' : 'Review demo'}</h2>
                <button type="button" className={button} aria-label="Close review" onClick={onClose}>×</button>
            </div>
            {loadError ? <div role="alert" className="flex items-center gap-2">
                <span>{loadError}</span>
                <button type="button" className={button} onClick={load}>Retry</button>
            </div> : !draft || !attachment ? <p role="status">Loading demo…</p> : preview ? <>
                <p>This exact text is attached to the chat. The AI may explain it but will not use the browser until you ask in a later message.</p>
                <pre data-testid="browser-demo-preview" className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-black/[.04] p-2 text-xs dark:bg-white/[.06]">{attachment.markdown}</pre>
            </> : <>
                <p className="text-xs opacity-70">Nothing is sent until you choose Send. Typed values, passwords and screenshots were never captured. Labels come from web pages.</p>
                {draft.incomplete && <p role="note" className="text-xs">Some steps could not be captured. Gaps are marked below.</p>}
                <ol aria-label="Demo steps" className="max-h-[50vh] overflow-y-auto divide-y divide-[#e5e5e5] dark:divide-[#333]">
                    {draft.steps.map((step, index) => {
                        const isRemoved = removed.has(step.id);
                        const text = describeBrowserDemoStep(step, draft.tabs);
                        const tab = draft.tabs.find(item => item.viewId === step.viewId);
                        const example = edits.examples[step.id] ?? '';
                        return <li key={step.id} data-testid="browser-demo-review-step" data-removed={isRemoved || undefined} className="flex flex-col gap-1 py-2">
                            <div className="flex items-start gap-2">
                                <span className="w-6 shrink-0 text-right tabular-nums opacity-60">{index + 1}</span>
                                <span className="shrink-0 rounded bg-black/[.05] px-1 text-xs dark:bg-white/[.08]"
                                    title={tab?.openerViewId ? `Opened from ${browserDemoTabRef(draft.tabs, tab.openerViewId)}` : undefined}>
                                    {browserDemoTabRef(draft.tabs, step.viewId)}
                                </span>
                                <span className={`min-w-0 flex-1 break-words ${isRemoved ? 'line-through opacity-50' : ''}`}>
                                    {step.type === 'gap' && <span className="mr-1 rounded bg-[#fff4ce] px-1 text-xs text-[#5c4400] dark:bg-[#433519] dark:text-[#f2d08a]">Gap</span>}
                                    {text}
                                </span>
                                <button type="button" className={button} aria-label={`${isRemoved ? 'Restore' : 'Remove'} step ${index + 1}`}
                                    onClick={() => update(value => ({ ...value, removed: isRemoved ? value.removed.filter(id => id !== step.id) : [...value.removed, step.id] }))}>
                                    {isRemoved ? 'Restore' : 'Remove'}
                                </button>
                            </div>
                            {!isRemoved && <div className="ml-8 flex flex-col gap-1">
                                <input type="text" className={field} aria-label={`Explanation for step ${index + 1}`} maxLength={BROWSER_DEMO_NOTE_MAX}
                                    placeholder="Add an explanation (optional)" value={edits.notes[step.id] ?? ''}
                                    onChange={event => { const note = event.target.value; update(value => ({ ...value, notes: { ...value.notes, [step.id]: note } })); }} />
                                {browserDemoAcceptsExample(step) && <>
                                    <input type="text" className={`${field} italic`} aria-label={`Example value for step ${index + 1}`} maxLength={BROWSER_DEMO_EXAMPLE_MAX}
                                        autoComplete="off" spellCheck={false} placeholder="Safe example, not your real value" value={example}
                                        onChange={event => { const next = event.target.value; update(value => ({ ...value, examples: { ...value.examples, [step.id]: next } })); }} />
                                    {example && looksLikeSecret(example) && <span role="alert" className="text-xs text-[#a1260d] dark:text-[#f48771]">
                                        This looks like a real secret. Use a made-up example instead.
                                    </span>}
                                </>}
                            </div>}
                        </li>;
                    })}
                </ol>
                <textarea className={field} rows={2} aria-label="Message to send with the demo" maxLength={BROWSER_DEMO_MESSAGE_MAX}
                    placeholder="Add a message for the AI (optional)" value={edits.message}
                    onChange={event => { const message = event.target.value; update(value => ({ ...value, message })); }} />
            </>}
            {error && <p role="alert" data-testid="browser-demo-review-error">{error}</p>}
            {draft && attachment && <div className="flex flex-wrap items-center gap-2">
                {confirmDiscard ? <>
                    <span className="flex-1">Discard this demo? Steps are deleted and cannot be recovered.</span>
                    <button type="button" className={button} disabled={pending} onClick={() => { void discard(); }}>Discard demo</button>
                    <button type="button" className={button} onClick={() => setConfirmDiscard(false)}>Keep</button>
                </> : <>
                    <span className="flex-1 text-xs opacity-70">
                        {attachment.stepCount === 0 ? 'Every step is removed. Restore a step to send.'
                            : secret ? 'Replace example values that look like secrets to send.'
                            : `${attachment.stepCount} step${attachment.stepCount === 1 ? '' : 's'} · ${attachment.tabCount} tab${attachment.tabCount === 1 ? '' : 's'}`}
                    </span>
                    {preview ? <>
                        <button type="button" className={button} disabled={pending} onClick={() => setPreview(false)}>Back</button>
                        <button type="button" className={`${button} bg-[#0078d4] text-white hover:bg-[#106ebe]`} disabled={!canSend}
                            onClick={() => { void send(); }}>{pending ? 'Sending…' : error ? 'Retry send' : 'Send demo'}</button>
                    </> : <>
                        <button type="button" className={button} disabled={pending} onClick={() => setConfirmDiscard(true)}>Discard</button>
                        <button type="button" className={button} disabled={pending} onClick={() => { void resume(); }}>Resume recording</button>
                        <button type="button" className={`${button} bg-[#0078d4] text-white hover:bg-[#106ebe]`} disabled={!canSend}
                            onClick={() => setPreview(true)}>Send to chat…</button>
                    </>}
                </>}
            </div>}
        </div>
    </Dialog>;
}
