import { useEffect, useRef, useState } from 'react';
import type { ProcessGroupPinType } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor } from '../api/cocClient';
import type { RepoGroupChatFeedModel } from './repoGroupChatFeed';
import type { RepoGroupChatOwnerHierarchy } from './repoGroupChatHierarchy';

/** Run summaries and pins belong to the source owner, not the selected navigation scope. */
export function useRepoGroupChatHierarchy(model: RepoGroupChatFeedModel | null, baseUrl?: string, searching = false) {
    const scope = model ? JSON.stringify([model.serverKey, model.groupId, model.membershipKey, baseUrl]) : '';
    const [state, setState] = useState<{ scope: string; owners: Record<string, RepoGroupChatOwnerHierarchy> }>({ scope: '', owners: {} });
    const [error, setError] = useState<string | null>(null);
    const generation = useRef(0);
    const pinRevision = useRef(new Map<string, number>());
    const current = useRef({ model, baseUrl, scope });
    current.current = { model, baseUrl, scope };

    useEffect(() => {
        const ticket = ++generation.current;
        setError(null);
        if (!model || searching || (model.serverKey !== 'local' && !baseUrl)) return;
        let disposed = false;
        const client = getCocClientFor(baseUrl);
        for (const source of model.sources) {
            if (!source.available || source.stale) continue;
            const pinKey = `${scope}|${source.workspaceId}`;
            const readRevision = pinRevision.current.get(pinKey);
            void Promise.allSettled([
                client.processes.listGroupPins(source.workspaceId),
                client.forEach.list(source.workspaceId),
                client.mapReduce.list(source.workspaceId),
                client.taskGroups.list(source.workspaceId),
            ]).then(([pins, each, reduce, groups]) => {
                if (disposed || generation.current !== ticket || current.current.scope !== scope
                    || !current.current.model?.sources.some(owner =>
                        owner.workspaceId === source.workspaceId && owner.available && !owner.stale)) return;
                setState(previous => {
                    const owners = previous.scope === scope ? previous.owners : {};
                    const previousOwner = owners[source.workspaceId];
                    return { scope, owners: { ...owners, [source.workspaceId]: {
                        pins: pins.status === 'fulfilled' && pinRevision.current.get(pinKey) === readRevision
                            ? pins.value.pins : previousOwner?.pins ?? [],
                        forEach: each.status === 'fulfilled' ? each.value : previousOwner?.forEach ?? [],
                        mapReduce: reduce.status === 'fulfilled' ? reduce.value : previousOwner?.mapReduce ?? [],
                        taskGroups: groups.status === 'fulfilled' ? groups.value : previousOwner?.taskGroups ?? [],
                    } } };
                });
                if ([pins, each, reduce, groups].some(result => result.status === 'rejected')) {
                    setError('Some owner run details could not be loaded.');
                }
            });
        }
        return () => { disposed = true; };
    }, [model, scope, baseUrl, searching]);

    const togglePin = async (ownerWorkspaceId: string, type: ProcessGroupPinType, groupId: string, pinned: boolean) => {
        const snapshot = current.current;
        const source = snapshot.model?.sources.find(source => source.workspaceId === ownerWorkspaceId);
        if (!source?.available || source.stale || (snapshot.model?.serverKey !== 'local' && !snapshot.baseUrl)) {
            throw new Error('The owning server is unavailable.');
        }
        const pinKey = `${snapshot.scope}|${ownerWorkspaceId}`;
        pinRevision.current.set(pinKey, (pinRevision.current.get(pinKey) ?? 0) + 1);
        const result = await getCocClientFor(snapshot.baseUrl).processes.pinGroup(ownerWorkspaceId, type, groupId, pinned);
        if (current.current.scope !== snapshot.scope || !current.current.model?.sources.some(source =>
            source.workspaceId === ownerWorkspaceId && source.available && !source.stale)) return;
        setState(previous => {
            const owners = previous.scope === snapshot.scope ? previous.owners : {};
            const owner = owners[ownerWorkspaceId] ?? { pins: [], forEach: [], mapReduce: [], taskGroups: [] };
            const pins = owner.pins.filter(pin => pin.type !== type || pin.groupId !== groupId);
            if (result.pin) pins.push(result.pin);
            return { scope: snapshot.scope, owners: { ...owners, [ownerWorkspaceId]: { ...owner, pins } } };
        });
    };
    return { owners: state.scope === scope ? state.owners : {}, error, togglePin };
}
