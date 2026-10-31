import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { desktopBrowserBridge, type BrowserDemoCommand, type BrowserDemoState } from './browser-bridge';
import { getBrowserDemoForOwner, getBrowserDemoForView, isBrowserDemoChatInView, runBrowserDemoCommand, subscribeBrowserDemos } from './browser-demo';
import { isBrowserDemoRecordingEnabled } from '../../utils/config';

export interface BrowserDemoStripProps {
    /** The tab's concrete owner workspace. */
    workspaceId?: string;
    /** The conversation a recording from this tab belongs to; null when there is none. */
    processId: string | null;
    /** The tab's routing session key. */
    routingRef: string;
    viewId: string;
    /** A web page is open in the tab, so recording can start. */
    ready: boolean;
    /** The tab is the selected, visible one: a recording counts switching to it. */
    active?: boolean;
    /** Open the review for a stopped demo; absent until review is available. */
    onReview?: (state: BrowserDemoState) => void;
}

const PAUSE_TEXT: Record<string, string> = {
    user: 'Paused',
    scope: 'Paused — open this chat to continue',
    disconnected: 'Paused — server disconnected',
};

/**
 * Record controls and the recording indicator. They live in the SPA toolbar, never in
 * page content, so pages cannot spoof or hide them.
 */
export function BrowserDemoStrip({ workspaceId, processId, routingRef, viewId, ready, active, onReview }: BrowserDemoStripProps) {
    const demo = useSyncExternalStore(subscribeBrowserDemos,
        useCallback(() => getBrowserDemoForView(routingRef, viewId), [routingRef, viewId]), () => null);
    const owner = workspaceId && processId ? { workspaceId, processId, routingRef } : null;
    const ownerDemo = useSyncExternalStore(subscribeBrowserDemos,
        useCallback(() => owner ? getBrowserDemoForOwner(owner) : null, [workspaceId, processId, routingRef]), () => null);
    const [error, setError] = useState<{ viewId: string; text: string } | null>(null);
    const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const inView = useSyncExternalStore(subscribeBrowserDemos,
        () => demo ? isBrowserDemoChatInView(demo.owner.processId) : false, () => false);
    const recordingHere = active && demo?.status === 'recording' ? demo.id : null;
    useEffect(() => {
        if (recordingHere) void runBrowserDemoCommand({ action: 'switch', viewId });
    }, [recordingHere, viewId]);
    const enabled = isBrowserDemoRecordingEnabled();
    // A running recording stays controllable even if the setting turns off mid-way.
    if (!demo && !enabled) return null;

    const run = async (command: BrowserDemoCommand) => {
        setError(null);
        setPending(true);
        try {
            const result = await runBrowserDemoCommand(command);
            if (!result.ok) {
                setError({ viewId, text: result.reason === 'engine-unsupported' || result.reason === 'handshake-failed'
                    ? `Demo recording is unavailable in this browser engine: ${result.message}` : result.message });
            }
            return result.ok;
        } finally {
            setPending(false);
        }
    };
    const button = 'rounded-lg border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 disabled:opacity-50 disabled:cursor-default';
    const errorText = error?.viewId === viewId ? error.text : null;
    const alert = errorText && <span className="w-full break-words" role="alert" data-testid="browser-demo-error">{errorText}</span>;

    if (!demo) {
        const supported = Boolean(desktopBrowserBridge()?.demo);
        const capturing = ownerDemo && ownerDemo.status !== 'stopped' ? ownerDemo : null;
        const reason = !supported ? 'Demo recording is unavailable in this desktop version.'
            : !owner ? 'Open a chat to record a demo.'
            : ownerDemo?.status === 'stopped' ? 'Review or discard this chat’s demo first.'
            : !ready ? 'Open a web page to record a demo.' : null;
        if (capturing) {
            return <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="browser-demo-add">
                <button type="button" className={button} disabled={pending || !ready}
                    title={ready ? 'Capture this tab in the chat’s demo recording' : 'Open a web page first.'}
                    onClick={() => { void run({ action: 'add-tab', id: capturing.id, viewId }); }}>Add to recording</button>
                {alert}
            </div>;
        }
        return <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="browser-demo-record">
            <button type="button" className={button} disabled={pending || reason !== null} title={reason ?? 'Record your steps in this tab as a demo for this chat'}
                aria-label="Record demo" onClick={() => { if (owner) void run({ action: 'start', owner, viewId }); }}>
                <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-[#d13438]" />Record
            </button>
            {!supported && <span role="status">{reason}</span>}
            {alert}
        </div>;
    }

    const steps = `${demo.stepCount} step${demo.stepCount === 1 ? '' : 's'}`;
    const tabs = `${demo.tabCount} tab${demo.tabCount === 1 ? '' : 's'}`;
    const label = demo.status === 'recording' ? `Recording demo · ${steps} · ${tabs}`
        : demo.status === 'paused' ? `${PAUSE_TEXT[demo.pauseReason ?? 'user']} · ${steps} · ${tabs}`
        : `Demo ready to review · ${steps} · ${tabs}`;
    const discarding = confirmDiscard === demo.id;
    return <div className="w-full min-w-0 flex flex-wrap items-center gap-2 rounded-xl bg-black/[.03] dark:bg-white/[.04] p-2 text-xs"
        data-testid="browser-demo-strip" data-status={demo.status}>
        <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${demo.status === 'recording' ? 'bg-[#d13438] motion-safe:animate-pulse' : 'bg-[#8a8886]'}`} />
        <span role="status" aria-live="polite">{label}</span>
        {discarding ? <>
            <span>Discard this demo? Steps are deleted and cannot be recovered.</span>
            <button type="button" className={button} disabled={pending}
                onClick={() => { void run({ action: 'discard', id: demo.id }).then(ok => { if (ok) setConfirmDiscard(null); }); }}>Discard demo</button>
            <button type="button" className={button} onClick={() => setConfirmDiscard(null)}>Keep</button>
        </> : <>
            {demo.status === 'recording' && <button type="button" className={button} disabled={pending} onClick={() => { void run({ action: 'pause', id: demo.id, reason: 'user' }); }}>Pause</button>}
            {demo.status === 'paused' && <button type="button" className={button} disabled={pending || (demo.pauseReason === 'scope' && !inView)}
                title={demo.pauseReason === 'scope' && !inView ? 'Open the recording chat to continue.' : undefined}
                onClick={() => { void run({ action: 'resume', id: demo.id }); }}>Resume</button>}
            {demo.status !== 'stopped' && <button type="button" className={button} disabled={pending} onClick={() => {
                void run({ action: 'stop', id: demo.id }).then(ok => { if (ok && onReview) onReview(demo); });
            }}>Stop</button>}
            {demo.status === 'stopped' && onReview && <button type="button" className={button} onClick={() => onReview(demo)}>Review</button>}
            {demo.status === 'stopped' && <button type="button" className={button} disabled={pending} onClick={() => { void run({ action: 'resume', id: demo.id }); }}>Resume recording</button>}
            <button type="button" className={button} disabled={pending} onClick={() => setConfirmDiscard(demo.id)}>Discard</button>
        </>}
        {demo.incomplete && <span className="w-full" role="note">Some steps could not be captured. Review will show the gaps.</span>}
        {demo.status !== 'stopped' && <span className="w-full opacity-70">AI browser input is paused for this chat. Typed values, passwords and screenshots are never captured.</span>}
        {alert}
    </div>;
}
