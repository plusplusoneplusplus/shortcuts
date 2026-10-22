import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CocClient, SentinelPrOutcomesResponse, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { useCocClient } from '../../../repos/cloneRouting';
import { Button } from '../../../ui/Button';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import { sentinelTodoOwnerKey, type SentinelTodoOwner } from './sentinelTodoPanelModel';

const MUTED = 'text-[#616161] dark:text-[#9d9d9d]';
const enabled = () => isFeatureEnabled('sentinelPrOutcomeWakeEnabled');
function subscribeConfig(listener: () => void) {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}

interface Props {
    owner: SentinelTodoOwner;
    item: SentinelTodoItem;
    client?: CocClient;
    ledgerRevision: number;
    onBusyChange?: (busy: boolean) => void;
}

export function SentinelTodoPrOutcomes(props: Props) {
    const show = useSyncExternalStore(subscribeConfig, enabled, enabled);
    const ref = props.owner.ownerRoutingRef === null ? undefined : props.owner.ownerRoutingRef ?? props.owner.ownerWorkspaceId;
    const resolvedClient = useCocClient(ref);
    const route = resolveCloneRoute(ref);
    if (!show || props.item.type === 'manual') return null;
    if (route.kind === 'unresolved-remote') return <p role="status" className={`px-2 text-xs ${MUTED}`}>
        PR outcomes unavailable: owning server is not connected.
    </p>;
    return <OutcomeDetails key={`${sentinelTodoOwnerKey(props.owner)}:${props.item.id}:${route.kind === 'remote' ? route.baseUrl : 'local'}`}
        {...props} client={props.client ?? resolvedClient} />;
}

type Snapshot = SentinelPrOutcomesResponse;

function OutcomeDetails({ owner, item, client, ledgerRevision, onBusyChange }: Props & { client: CocClient }) {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const current = useRef<Snapshot | null>(null);
    const [readError, setReadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        onBusyChange?.(busy);
        return () => onBusyChange?.(false);
    }, [busy, onBusyChange]);
    const [loading, setLoading] = useState(true);
    const live = useRef(false);
    const sequence = useRef(0);
    const read = useRef<AbortController | null>(null);
    const mutation = useRef<AbortController | null>(null);
    const accept = useCallback((value: Snapshot) => {
        if (current.current && value.revision < current.current.revision) {
            setReadError('PR outcomes changed while loading. Check again for current evidence.');
            return;
        }
        current.current = value;
        setSnapshot(value);
        setReadError(null);
    }, []);
    const load = useCallback(async () => {
        if (!live.current || mutation.current) return;
        read.current?.abort();
        const controller = new AbortController();
        read.current = controller;
        const seq = ++sequence.current;
        setLoading(true);
        try {
            const value = await client.sentinelTodos.listPrOutcomes(owner.ownerWorkspaceId, owner.processId, item.id, { signal: controller.signal });
            if (live.current && !controller.signal.aborted && seq === sequence.current) accept(value);
        } catch (failure) {
            if (live.current && !controller.signal.aborted && seq === sequence.current) {
                setReadError(failure instanceof Error ? failure.message : String(failure));
            }
        } finally {
            if (live.current && !controller.signal.aborted && seq === sequence.current) setLoading(false);
        }
    }, [client, owner.ownerWorkspaceId, owner.processId, item.id, accept]);
    useEffect(() => {
        live.current = true;
        mutation.current = null;
        current.current = null;
        setSnapshot(null);
        setReadError(null);
        setActionError(null);
        setBusy(false);
        setLoading(true);
        const connection = client.events.connect({ workspaceId: owner.ownerWorkspaceId, onMessage: message => {
            const event = message as { type?: string; workspaceId?: string; processId?: string };
            if (event.workspaceId !== owner.ownerWorkspaceId || event.processId !== owner.processId) return;
            if (event.type?.startsWith('trigger') || event.type === 'sentinel-todos-changed') void load();
        } });
        return () => {
            live.current = false;
            sequence.current++;
            read.current?.abort();
            mutation.current?.abort();
            connection.close();
        };
    }, [client, owner.ownerWorkspaceId, owner.processId, load]);
    useEffect(() => { void load(); }, [load, item.revision, ledgerRevision]);

    const act = async (kind: 'check' | 'toggle') => {
        if (mutation.current || !current.current || !live.current) return;
        const base = current.current;
        read.current?.abort();
        const controller = new AbortController();
        mutation.current = controller;
        const seq = ++sequence.current;
        setBusy(true);
        setLoading(false);
        setActionError(null);
        try {
            const value = kind === 'check'
                ? await client.sentinelTodos.checkPrOutcomes(owner.ownerWorkspaceId, owner.processId, item.id,
                    { expectedRevision: base.revision }, { signal: controller.signal })
                : base.paused
                    ? await client.sentinelTodos.resumePrOutcomes(owner.ownerWorkspaceId, owner.processId, item.id,
                        { expectedRevision: base.revision }, { signal: controller.signal })
                    : await client.sentinelTodos.pausePrOutcomes(owner.ownerWorkspaceId, owner.processId, item.id,
                        { expectedRevision: base.revision }, { signal: controller.signal });
            if (!live.current || controller.signal.aborted || seq !== sequence.current) return;
            accept(value);
        } catch (failure) {
            if (!live.current || controller.signal.aborted || seq !== sequence.current) return;
            const detail = failure as { status?: number; code?: string; message?: string } | null;
            const message = detail?.message || 'Could not update PR outcomes.';
            setActionError(detail?.status === 409 || detail?.code === 'conflict'
                ? `${message} Refreshing current PR outcomes; review them before trying again.` : message);
        } finally {
            if (live.current && !controller.signal.aborted && seq === sequence.current) {
                mutation.current = null;
                setBusy(false);
                await load();
            }
        }
    };
    return <section aria-label={`PR outcomes for ${item.title}`} className="flex flex-col gap-1 px-2 pb-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1">
            <strong className={MUTED}>PR outcomes</strong>
            {snapshot && snapshot.outcomes.length === 0 && <span className={MUTED}>No recorded PR outcomes.</span>}
            {snapshot?.paused && <span className={MUTED}>Notifications paused</span>}
            <Button size="sm" variant="ghost" disabled={busy || loading || !snapshot} onClick={() => void act('check')}>Check outcome</Button>
            <Button size="sm" variant="ghost" disabled={busy || loading || !snapshot} onClick={() => void act('toggle')}>
                {snapshot?.paused ? 'Resume notifications' : 'Pause notifications'}
            </Button>
        </div>
        {loading && !snapshot && <span role="status" className={MUTED}>Loading PR evidence…</span>}
        {snapshot && snapshot.outcomes.length > 0 && <ul aria-label="Exact PR evidence" className="flex flex-col gap-1">
            {snapshot.outcomes.map(watch => <li key={watch.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <a href={watch.pr.url} target="_blank" rel="noopener noreferrer" className="break-all text-[#0078d4] hover:underline">
                    PR {watch.pr.repoPath}#{watch.pr.number}
                </a>
                <span>{watch.status}</span>
                <span className={MUTED}>{watch.delivery === 'delivered' ? 'Review queued'
                    : watch.delivery === 'error' ? 'Review failed' : `Notification: ${watch.delivery}`}</span>
                {watch.error && <span role="alert" className="w-full text-[#c72e2e] dark:text-[#f48771]">{watch.error}</span>}
            </li>)}
        </ul>}
        {readError && <div role="alert">Evidence unavailable: {readError}{' '}
            <Button size="sm" variant="ghost" disabled={busy || loading} onClick={() => void load()}>Refresh PR evidence</Button>
        </div>}
        {actionError && <div role="alert">{actionError}</div>}
    </section>;
}
