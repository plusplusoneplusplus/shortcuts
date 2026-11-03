import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RuntimeDashboardConfig } from '@plusplusoneplusplus/coc-client';
import { useCocClient, useCloneBaseUrl } from '../../repos/cloneRouting';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { DASHBOARD_CONFIG_UPDATED_EVENT, getFeatureValue } from '../../utils/config';
import { BrowserAnnotationSession, type DesktopBrowserAnnotation } from './browser-annotation';
import { applyBrowserAnnotationEvents } from './browser-annotation-chips';
import type { BrowserDemoOwner } from './browser-bridge';
import { getBrowserTakeover, subscribeBrowserTakeover } from './browser-takeover';
import { getBrowserControlActivity, subscribeBrowserControlActivity } from './browser-control-activity';

function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}
const localPolicy = () => `${getFeatureValue('browserAnnotationEnabled') !== false}:${getFeatureValue('browserHumanTakeoverEnabled') === true}`;

/** Resolve policy on the tab's concrete server, independently of AI tool enablement. */
function useAnnotationPolicy(routingRef: string) {
    const client = useCocClient(routingRef);
    const baseUrl = useCloneBaseUrl(routingRef);
    const route = resolveCloneRoute(routingRef);
    const owner = route.kind === 'remote' ? route.baseUrl : route.kind;
    const local = useSyncExternalStore(subscribeConfig, localPolicy, localPolicy);
    const [remote, setRemote] = useState<{ owner: string; value: string } | null>(null);
    useEffect(() => {
        if (route.kind !== 'remote') return;
        let generation = 0;
        let disposed = false;
        let read: AbortController | undefined;
        const load = async () => {
            const current = ++generation;
            read?.abort();
            read = new AbortController();
            try {
                const config = await client.request<RuntimeDashboardConfig>('/config/runtime', { signal: read.signal });
                if (!disposed && current === generation) setRemote({ owner,
                    value: `${config.features?.browserAnnotationEnabled !== false}:${config.features?.browserHumanTakeoverEnabled === true}` });
            } catch {
                if (!disposed && current === generation) setRemote({ owner, value: 'false:false' });
            }
        };
        const refresh = () => { void load(); };
        const onRemote = (event: Event) => {
            const detail = (event as CustomEvent<{ baseUrl?: string; message?: { type?: string } }>).detail;
            if (detail?.baseUrl === baseUrl && (event.type === 'coc-remote-ws-connect' || detail.message?.type === 'config-changed')) refresh();
        };
        refresh();
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh);
        window.addEventListener('coc-remote-ws-message', onRemote);
        window.addEventListener('coc-remote-ws-connect', onRemote);
        return () => {
            disposed = true; generation++; read?.abort();
            window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, refresh);
            window.removeEventListener('coc-remote-ws-message', onRemote);
            window.removeEventListener('coc-remote-ws-connect', onRemote);
        };
    }, [client, owner, baseUrl, route.kind]);
    const value = route.kind === 'local' ? local : remote?.owner === owner ? remote.value : 'false:false';
    const [annotation, takeover] = value.split(':');
    return { enabled: annotation === 'true', takeoverEnabled: takeover === 'true' };
}

export interface BrowserAnnotationButtonProps {
    bridge: DesktopBrowserAnnotation;
    sessionKey: string;
    viewId: string;
    workspaceId?: string;
    tabId: string;
    active: boolean;
    ready: boolean;
    excluded: boolean;
    /** Changes on document commit, load, failure or owner replacement. */
    documentKey: string;
    /** The chat whose composer receives saved comments; fixed for each mode. */
    chatOwner: BrowserDemoOwner | null;
}

/** One tab/document owns a mode; main performs takeover before injecting the overlay. */
export function BrowserAnnotationButton(props: BrowserAnnotationButtonProps) {
    const policy = useAnnotationPolicy(props.sessionKey);
    const baseUrl = useCloneBaseUrl(props.sessionKey);
    const takeover = useSyncExternalStore(subscribeBrowserTakeover,
        useCallback(() => getBrowserTakeover(props.sessionKey, props.viewId), [props.sessionKey, props.viewId]), () => null);
    const activity = useSyncExternalStore(subscribeBrowserControlActivity,
        useCallback(() => props.workspaceId ? getBrowserControlActivity(props.workspaceId, props.tabId, baseUrl) : null,
            [props.workspaceId, props.tabId, baseUrl]), () => null);
    const [phase, setPhase] = useState<'off' | 'starting' | 'on' | 'stopping'>('off');
    const [error, setError] = useState<string | null>(null);
    const session = useRef<BrowserAnnotationSession | null>(null);
    const operation = useRef<object | null>(null);
    const live = useRef(true);
    const allowed = policy.enabled && props.active && props.ready && !props.excluded;
    // A different target chat ends the mode, so a comment never lands in a chat the user left.
    const ownerKey = props.chatOwner ? JSON.stringify([props.chatOwner.workspaceId, props.chatOwner.routingRef, props.chatOwner.processId]) : '';

    useEffect(() => {
        live.current = true;
        return () => { live.current = false; };
    }, []);

    useEffect(() => {
        let disposed = false;
        void props.bridge.setEnabled(props.sessionKey, policy.enabled).catch(() => {
            if (!disposed) setError('Could not apply annotation setting. Retry Annotate.');
        });
        return () => { disposed = true; };
    }, [props.bridge, props.sessionKey, policy.enabled]);

    const stop = async () => {
        const previous = session.current;
        if (!previous) return;
        session.current = null;
        const current = {};
        operation.current = current;
        if (live.current) setPhase('stopping');
        try { await previous.stop(); }
        catch { if (live.current) setError('Could not exit annotation mode. Retry Annotate or close the tab.'); }
        finally {
            if (operation.current === current) {
                operation.current = null;
                if (live.current) setPhase('off');
            }
        }
    };

    useEffect(() => {
        // Cleanup revokes the old generation synchronously, including pending Start.
        return () => { void stop(); };
    }, [props.bridge, props.sessionKey, props.viewId, props.documentKey, allowed, ownerKey]);

    const toggle = async () => {
        if (operation.current) return;
        setError(null);
        if (session.current) { await stop(); return; }
        const owner = props.chatOwner;
        if (!allowed || !owner) return;
        const current = {};
        operation.current = current;
        setPhase('starting');
        const next = new BrowserAnnotationSession(props.bridge, props.viewId, props.sessionKey, event => {
            // The session drops foreign and late notifications; saved comments outlive the mode.
            if (event.type === 'events') {
                try { applyBrowserAnnotationEvents(owner, next, event.events); }
                catch (failure) {
                    setError(failure instanceof Error ? failure.message : String(failure));
                    void stop();
                    return;
                }
            }
            if (session.current !== next) return;
            if (event.type === 'ended') {
                session.current = null;
                setPhase('off');
                if (event.error) setError(event.error);
            }
        });
        session.current = next;
        try {
            // Never race Start against a pending policy publication.
            await props.bridge.setEnabled(props.sessionKey, true);
            if (session.current !== next) return;
            const started = await next.start();
            if (session.current !== next) return;
            if (started) setPhase('on');
            else { session.current = null; setPhase('off'); setError('Annotation unavailable. Check that this page is ready and retry.'); }
        } catch {
            if (session.current === next) {
                session.current = null; setPhase('off'); setError('Could not start annotation mode. Retry Annotate.');
            }
        } finally { if (operation.current === current) operation.current = null; }
    };

    useEffect(() => {
        if (!allowed) return;
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || !session.current) return;
            event.preventDefault();
            void stop();
        };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
    });

    const alert = error && <span role="alert" className="w-full text-xs text-[#cf222e]">{error}</span>;
    if (!policy.enabled || props.excluded) return alert;
    const agent = takeover?.status === 'agent' || Boolean(activity && (!takeover || takeover.status === 'terminated'));
    const reason = !props.bridge.supported ? 'Annotation is unavailable in this desktop version.'
        : !props.ready ? 'Open a loaded web page to annotate.'
        : !props.active ? 'Select this tab to annotate.'
        : !props.chatOwner ? 'Open a chat to receive annotation comments.'
        : agent && !policy.takeoverEnabled ? 'Enable human takeover in Admin → Browser to annotate during an agent turn.'
        : takeover?.status === 'taking-over' || takeover?.status === 'checking' ? 'Wait for browser control to settle.' : null;
    const pending = phase === 'starting' || phase === 'stopping';
    return <>
        <button type="button" aria-label="Annotate" aria-pressed={phase === 'on'} disabled={pending || Boolean(reason)}
            title={reason ?? (phase === 'on' ? 'Exit annotation mode (Esc)' : agent ? 'Take over and annotate this page' : 'Annotate this page')}
            className="shrink-0 rounded-lg border border-black/10 dark:border-white/15 px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 aria-pressed:bg-blue-100 dark:aria-pressed:bg-blue-900"
            onClick={() => { void toggle(); }}>{phase === 'starting' ? 'Starting…' : phase === 'stopping' ? 'Exiting…' : 'Annotate'}</button>
        {alert}
    </>;
}
