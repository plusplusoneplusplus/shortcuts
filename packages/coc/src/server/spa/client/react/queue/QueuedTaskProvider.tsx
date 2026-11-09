import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getCocClientFor, getSpaCocClientErrorMessage } from '../api/cocClient';
import { ProviderBadge, getProviderLabel, type ProviderBadgeProvider } from '../features/chat/ProviderBadge';
import { useWorkspaceOwner } from '../repos/workspaceOwnerContext';
import { parseRemoteCloneKey } from '../repos/cloneIdentity';
import { resolveCloneRoute, subscribeCloneBaseUrl } from '../repos/cloneRegistry';
import type { ChatProvider } from '../utils/providerSelection';

interface Props {
    task: any;
    workspaceId?: string;
    sourceSelectionId?: string;
    sourceBaseUrl?: string;
    provider?: ProviderBadgeProvider;
    onUpdated: (task: any) => void;
}

export function useQueueDetailsOwner({ workspaceId, sourceSelectionId, sourceBaseUrl }: Pick<Props, 'workspaceId' | 'sourceSelectionId' | 'sourceBaseUrl'>) {
    const scopedOwner = useWorkspaceOwner(workspaceId);
    const ownerRef = scopedOwner?.selectionId ?? sourceSelectionId ?? workspaceId;
    const resolveEndpoint = () => {
        if (scopedOwner) return scopedOwner.baseUrl ?? '';
        if (sourceBaseUrl) return sourceBaseUrl;
        // Explicit local owners stay local despite colliding remote workspace IDs.
        if (sourceSelectionId && !parseRemoteCloneKey(sourceSelectionId)) return '';
        const route = resolveCloneRoute(ownerRef);
        return route.kind === 'remote' ? route.baseUrl : route.kind === 'local' ? '' : null;
    };
    const endpoint = useSyncExternalStore(
        listener => subscribeCloneBaseUrl(ownerRef, listener), resolveEndpoint, resolveEndpoint,
    );
    return { endpoint, resolveEndpoint, ownerRef,
        client: endpoint === null ? null : scopedOwner?.client ?? getCocClientFor(endpoint),
        workspaceId: scopedOwner?.workspaceId ?? parseRemoteCloneKey(workspaceId)?.workspaceId ?? workspaceId };
}

export function QueuedTaskProvider(props: Props) {
    const { task, provider, onUpdated } = props;
    const { endpoint, resolveEndpoint, ownerRef, workspaceId, client } = useQueueDetailsOwner(props);
    const identity = `${ownerRef}\n${endpoint}\n${workspaceId}\n${task.id}\n${task.status}`;
    const currentIdentity = useRef(identity);
    currentIdentity.current = identity;
    const [choices, setChoices] = useState<ChatProvider[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const pending = useRef(false);
    const generation = useRef(0);
    useEffect(() => {
        currentIdentity.current = identity;
        setChoices(null);
        setError('');
        setBusy(false);
        pending.current = false;
        return () => { currentIdentity.current = ''; generation.current += 1; };
    }, [identity, client]);

    const request = async (selection?: ChatProvider) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError('');
        const captured = identity;
        const capturedGeneration = generation.current;
        try {
            if (!client || !workspaceId) throw new Error('Workspace owner is unavailable');
            // Resolve again at dispatch so topology changes cannot send to an old owner.
            if (resolveEndpoint() !== endpoint) throw new Error('Workspace owner changed');
            const data = await client.request<{ providers?: ChatProvider[]; task?: any }>(
                `/queue/${encodeURIComponent(task.id)}/provider`, {
                    query: { workspace: workspaceId },
                    ...(selection ? { method: 'PATCH', body: { provider: selection } } : {}),
                },
            );
            if (currentIdentity.current !== captured || generation.current !== capturedGeneration || resolveEndpoint() !== endpoint) return;
            if (selection) {
                onUpdated(data.task);
                setChoices(null);
            } else setChoices(data.providers ?? []);
        } catch (error) {
            if (currentIdentity.current === captured && generation.current === capturedGeneration) setError(getSpaCocClientErrorMessage(error, 'Could not change provider'));
        } finally {
            if (currentIdentity.current === captured && generation.current === capturedGeneration) {
                pending.current = false;
                setBusy(false);
            }
        }
    };
    return (
        <span className="inline-flex flex-col items-start gap-1">
            <button type="button" aria-label="Change queued job provider" disabled={busy || task.status !== 'queued'}
                onClick={() => choices ? setChoices(null) : void request()}>
                {provider ? <ProviderBadge provider={provider} /> : <span className="underline">Default</span>}
            </button>
            {choices && <select aria-label="Queued job provider" disabled={busy} value={provider === 'auto-pending' ? 'auto' : provider ?? ''}
                onChange={event => void request(event.target.value as ChatProvider)}>
                {(!provider || !choices.includes(provider === 'auto-pending' ? 'auto' : provider)) && <option value={provider === 'auto-pending' ? 'auto' : provider ?? ''} disabled>Current provider</option>}
                {choices.map(choice => <option key={choice} value={choice}>{choice === 'auto' ? 'Auto' : getProviderLabel(choice)}</option>)}
            </select>}
            {busy && <span role="status">Updating provider…</span>}
            {error && <span role="alert" className="text-red-600">{error}</span>}
        </span>
    );
}
