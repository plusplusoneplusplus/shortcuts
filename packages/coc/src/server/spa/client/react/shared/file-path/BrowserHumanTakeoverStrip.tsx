import { useCallback, useState, useSyncExternalStore } from 'react';
import { desktopBrowserBridge } from './browser-bridge';
import { getBrowserTakeover, subscribeBrowserTakeover } from './browser-takeover';
import { isFeatureEnabled } from '../../utils/config';

/** Lives in the browser toolbar, above both native and DOM guest surfaces. */
export function BrowserHumanTakeoverStrip({ routingRef, viewId }: { routingRef: string; viewId: string }) {
    const state = useSyncExternalStore(subscribeBrowserTakeover,
        useCallback(() => getBrowserTakeover(routingRef, viewId), [routingRef, viewId]), () => null);
    const control = desktopBrowserBridge()?.control;
    const [draft, setDraft] = useState<{ owner: string; text: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (!state) {
        return isFeatureEnabled('browserHumanTakeoverEnabled') && !control?.humanTakeoverSupported
            ? <div className="w-full text-xs" role="status">Human takeover is unavailable in this desktop version.</div> : null;
    }
    if (state.status === 'terminated') return <div className="w-full text-xs" role="status">Browser continuation stopped.</div>;
    const owner = JSON.stringify([state.routingRef, state.workspaceId, state.processId, state.turnId, viewId]);
    const note = draft?.owner === owner ? draft.text : '';
    const human = state.status === 'human';
    const label = state.status === 'taking-over' ? 'Taking over…' : state.status === 'checking' ? 'Checking page…'
        : human ? (state.reason ? 'Your help needed — You have control' : 'You have control') : 'Agent in control';
    const act = async (action: 'take' | 'return' | 'stop') => {
        setError(null);
        try {
            if (!control?.takeover) throw new Error('Human takeover is unavailable in this desktop version.');
            await control.takeover(state, action, action === 'return' ? note : undefined);
            if (action === 'return' || action === 'stop') setDraft(current => current?.owner === owner ? null : current);
        } catch { setError('Could not change browser control. Retry or Stop.'); }
    };
    const button = 'rounded-lg border border-black/10 dark:border-white/15 px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2';
    return <div className="w-full min-w-0 flex flex-wrap items-center gap-2 rounded-xl bg-black/[.03] dark:bg-white/[.04] p-2 text-xs" data-testid="browser-human-takeover">
        <span role="status" aria-live="polite">{label}</span>
        {state.reason && <span className="break-words min-w-0 w-full">{state.reason}</span>}
        {state.status === 'agent' && <button type="button" className={button} onClick={() => { void act('take'); }}>Take over</button>}
        {human && <>
            <label className="flex flex-wrap gap-1 min-w-0 flex-1">Handoff note (optional)
                <input className="min-w-0 w-full rounded border border-black/10 dark:border-white/15 bg-transparent px-2 py-1" value={note} maxLength={2000} onChange={event => setDraft({ owner, text: event.target.value })} />
            </label>
            <button type="button" className={button} onClick={() => { void act('return'); }}>Return to agent</button>
        </>}
        {state.status !== 'agent' && <button type="button" className={button} onClick={() => { void act('stop'); }}>Stop</button>}
        {(state.error || error) && <span className="w-full" role="alert">{state.error || error}</span>}
        {human && <span className="w-full opacity-70">Browser input and observation are paused across this conversation’s tabs. Information already seen cannot be erased.</span>}
    </div>;
}
