import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { RichTextInput, type RichTextInputHandle, type RichTextInputProps } from '../../shared/RichTextInput';
import { useCocClient } from '../../repos/cloneRouting';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';
import { getCocClientFor } from '../../api/cocClient';
import { DASHBOARD_CONFIG_UPDATED_EVENT, getFeatureValue } from '../../utils/config';
import { getDashboardTopology, subscribeDashboardTopology } from '../../shared/dashboard-discovery/topology';
import { targetQuery, targetToken, targetSpans } from '../../../../../shared/sentinel-target-reference';
import { discoverSentinelTargets, type SentinelTargetResult } from './sentinelTargetDiscovery';

interface Props extends RichTextInputProps {
    sentinel: boolean;
    ownerRef?: string;
    sourceBaseUrl?: string;
}
/** Shared initial/follow-up surface. All reference state lives in the editor's serialized value. */
export const SentinelTargetInput = forwardRef<RichTextInputHandle, Props>(function SentinelTargetInput(
    { sentinel, ownerRef, sourceBaseUrl, ...props }, ref,
) {
    const editor = useRef<RichTextInputHandle>(null);
    useImperativeHandle(ref, () => ({
        getValue: () => editor.current?.getValue() ?? '',
        setValue: (text, cursor) => editor.current?.setValue(text, cursor),
        focus: () => editor.current?.focus(),
    }));
    const client = useCocClient(ownerRef);
    const scopedOwner = useWorkspaceOwner(ownerRef);
    const route = resolveCloneRoute(ownerRef);
    const unresolved = !scopedOwner && !sourceBaseUrl && route.kind === 'unresolved-remote';
    const ownerClient = sourceBaseUrl ? getCocClientFor(sourceBaseUrl) : client;
    const remote = !!sourceBaseUrl || !!scopedOwner?.baseUrl || route.kind === 'remote';
    const [policy, setPolicy] = useState<{ client: typeof client; ownerRef?: string; enabled: boolean }>();
    const [configEpoch, setConfigEpoch] = useState(0);
    useEffect(() => {
        const update = () => setConfigEpoch(n => n + 1);
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, update);
    }, []);
    useEffect(() => {
        if (!sentinel || unresolved) return;
        const abort = new AbortController();
        let active = true;
        if (!remote) setPolicy({ client: ownerClient, ownerRef, enabled: getFeatureValue('sentinelTargetAutocompleteEnabled') === true });
        else {
            void ownerClient.request<{ features?: { sentinelTargetAutocompleteEnabled?: boolean } }>('/config/runtime', { signal: abort.signal })
                .then(config => { if (active) setPolicy({ client: ownerClient, ownerRef, enabled: config.features?.sentinelTargetAutocompleteEnabled === true }); })
                .catch(() => { if (active) setPolicy({ client: ownerClient, ownerRef, enabled: false }); });
        }
        return () => { active = false; abort.abort(); };
    }, [sentinel, unresolved, remote, ownerClient, ownerRef, configEpoch]);
    const enabled = sentinel && !unresolved && policy?.client === ownerClient && policy.ownerRef === ownerRef && policy.enabled;
    const [cursor, setCursor] = useState(0);
    const [dismissed, setDismissed] = useState<string>();
    const query = enabled && !props.disabled ? targetQuery(props.value ?? '', cursor) : null;
    const queryKey = JSON.stringify([ownerRef, sourceBaseUrl, query]);
    const open = !!query && dismissed !== queryKey;
    const snapshot = useSyncExternalStore(subscribeDashboardTopology, getDashboardTopology, getDashboardTopology);
    const [retry, setRetry] = useState(0);
    const [state, setState] = useState<{ snapshot: typeof snapshot; client: typeof client; ownerRef?: string; rows: SentinelTargetResult[]; error?: string }>();
    const [highlight, setHighlight] = useState(0);
    const [drill, setDrill] = useState<{ identity: string; prefix: string }>();
    useEffect(() => { setDrill(undefined); setDismissed(undefined); }, [ownerRef, sourceBaseUrl, sentinel]);
    useEffect(() => { setHighlight(0); }, [queryKey]);
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        let active = true;
        const timer = window.setTimeout(() => { controller.abort(); if (active) setState({ snapshot, client: ownerClient, ownerRef, rows: [], error: 'Discovery timed out. Retry.' }); }, 10000);
        setState(undefined);
        void discoverSentinelTargets(snapshot, controller.signal).then(rows => {
            if (active && !controller.signal.aborted) setState({ snapshot, client: ownerClient, ownerRef, rows });
        }).catch(() => {
            if (active && !controller.signal.aborted) setState({ snapshot, client: ownerClient, ownerRef, rows: [], error: 'Discovery unavailable. Retry.' });
        }).finally(() => window.clearTimeout(timer));
        return () => { active = false; controller.abort(); window.clearTimeout(timer); };
    }, [open, snapshot, ownerClient, ownerRef, retry]);
    const currentState = state?.snapshot === snapshot && state.client === ownerClient && state.ownerRef === ownerRef ? state : undefined;
    const drilled = drill && query?.query.startsWith(drill.prefix) ? drill : undefined;
    const needle = (drilled ? query!.query.slice(drilled.prefix.length) : query?.query ?? '').toLocaleLowerCase();
    const rows = currentState?.rows.filter(row =>
        (!drilled || row.target.serverIdentity === drilled.identity)
        && (drilled && row.target.kind === 'server' ? !needle : `${row.name} ${row.owner}`.toLocaleLowerCase().includes(needle))) ?? [];
    // A drill's first action is explicit server-only selection.
    if (drilled) rows.sort((a, b) => Number(b.target.kind === 'server') - Number(a.target.kind === 'server'));
    const index = Math.min(highlight, Math.max(0, rows.length - 1));
    const menuId = useId();
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [open, index, queryKey, currentState]);
    const choose = (row: SentinelTargetResult) => {
        if (!query || !row.online) return;
        if (row.target.kind === 'server' && !drilled) {
            const prefix = `${encodeURIComponent(row.name)}/`;
            editor.current?.replaceRange?.(query.start, query.end, `#${prefix}`);
            setDrill({ identity: row.target.serverIdentity, prefix });
        } else {
            const label = row.target.kind === 'server' ? `#${row.owner}` : `#${row.owner} / ${row.name}`;
            editor.current?.replaceRange?.(query.start, query.end, targetToken(row.target, label) + ' ');
            setDismissed(undefined);
            setDrill(undefined);
        }
    };
    return <div className="relative min-w-0 w-full">
        {open && <div className="absolute bottom-full mb-1 left-0 w-full min-w-0 z-50 rounded-lg border border-teal-600 bg-white dark:bg-[#202928] shadow-lg p-1" data-testid="sentinel-target-menu">
            <div className="text-xs px-2 py-1 text-teal-700 dark:text-teal-300">Sentinel targets · Context only</div>
            <div role="status" aria-live="polite" className="text-xs px-2">
                {!currentState ? 'Loading targets…' : currentState.error ?? (!rows.length ? 'No matching targets' : '')}
            </div>
            <div ref={listRef} id={menuId} role="listbox" aria-label="Sentinel targets" className="max-h-60 overflow-y-auto">
                {rows.map((row, i) => <div key={JSON.stringify(row.target)} id={`${menuId}-${i}`} role="option" aria-label={`${drilled && row.target.kind === 'server' ? 'Use this server' : row.name} · ${row.owner} · ${row.target.kind}`} aria-selected={index === i} aria-disabled={!row.online}
                    onPointerDown={e => e.preventDefault()} onClick={() => choose(row)}
                    className={`min-h-[44px] cursor-pointer rounded px-2 py-1 text-sm ${i === index ? 'bg-teal-100 dark:bg-teal-900' : ''} ${!row.online ? 'opacity-60' : ''}`}>
                    <div className="flex flex-wrap items-center gap-x-2"><span className="font-medium min-w-0 max-w-full break-words">{drilled && row.target.kind === 'server' ? 'Use this server' : row.name}</span>
                        <span className="text-xs">{row.target.kind === 'workspace' ? 'Repo' : row.target.kind === 'group' ? `Group · ${row.members === undefined ? '?' : row.members} members` : 'Server'}</span>
                    </div>
                    <div className="text-xs break-words">{row.owner}{!row.online ? ` · ${row.error ?? 'Offline / unavailable'}` : ''}</div>
                </div>)}
            </div>
            {(currentState?.error || currentState?.rows.some(r => r.error)) && <button type="button" className="min-h-[44px] px-2 text-sm text-teal-700 dark:text-teal-300" onClick={() => setRetry(n => n + 1)}>Retry discovery</button>}
        </div>}
        <RichTextInput {...props} ref={editor} atomicTargets={enabled || targetSpans(props.value ?? '').length > 0} ghostText={open ? undefined : props.ghostText}
            role={enabled ? 'combobox' : undefined} aria-label={enabled ? 'Sentinel message' : undefined}
            aria-expanded={enabled ? open : undefined} aria-controls={open ? menuId : undefined}
            aria-activedescendant={open && rows.length ? `${menuId}-${index}` : undefined}
            onCursorChange={setCursor}
            onChange={(text, pos) => { setCursor(pos); props.onChange(text, pos); }}
            onKeyDown={e => {
                if (open && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    if (e.key === 'Escape') { e.preventDefault(); setDismissed(queryKey); return; }
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHighlight((index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % (rows.length || 1)); return; }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (rows[index]) choose(rows[index]); return; }
                }
                props.onKeyDown?.(e);
            }} />
    </div>;
});
