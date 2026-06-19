/**
 * usePrChatStatusItems — runtime data layer that closes AC-01 (detect + persist)
 * and feeds AC-02's {@link PrStatusCard}.
 *
 * Given a chat's loaded turns, workspace, remote URL, and task id this hook:
 *   1. resolves the chat's canonical origin (reusing {@link resolveCanonicalOriginId}),
 *   2. gathers PRs detected in the loaded turns (reusing the shared detection),
 *   3. fetches persisted bindings for this chat's task and unions them with the
 *      detected PRs (so a PR survives reload with its creating turn collapsed),
 *   4. upserts a binding for any freshly-detected PR not yet persisted
 *      (best-effort POST), and
 *   5. fetches PR detail per association, mapping it to a {@link PrStatusCardItem}
 *      with per-row loading / ready / error state and a retry.
 *
 * All the union / detection / origin logic lives in the pure
 * {@link ./prChatAssociation} module (unit-tested independently); this hook is the
 * thin async/React layer over it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientConversationTurn } from '../../../types/dashboard';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import {
    detectedPrsNeedingBinding,
    gatherDetectedPrsFromTurns,
    unionAssociations,
    type PrAssociation,
    type PrChatBindingLike,
} from './prChatAssociation';
import type { PrStatusCardItem, PrStatusCardPr } from './PrStatusCard';

export interface UsePrChatStatusItemsOptions {
    /** Currently-loaded conversation turns (PRs are detected in their tool output). */
    turns: readonly ClientConversationTurn[] | undefined;
    /** Chat's owning workspace id (origin resolution + binding scope). */
    workspaceId: string | undefined;
    /** Workspace remote URL — resolves the chat's canonical origin for bindings. */
    remoteUrl: string | null | undefined;
    /** Chat's task id — scopes the persisted bindings (`task_id`). */
    taskId: string | undefined;
}

export interface UsePrChatStatusItemsResult {
    items: PrStatusCardItem[];
    /** Re-fetch a single failed row's detail. */
    retry: (key: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/**
 * Maps a fetched PR-detail payload (the canonical `PullRequest` shape) to the
 * card's {@link PrStatusCardPr} subset. Returns undefined when the payload is not
 * a recognizable PR detail (missing title/status), so callers surface an error.
 */
export function mapPrDetailToCardPr(detail: unknown): PrStatusCardPr | undefined {
    if (!isRecord(detail)) return undefined;
    const title = optionalString(detail.title);
    const status = optionalString(detail.status);
    if (title === undefined || status === undefined) return undefined;
    return {
        number: typeof detail.number === 'number' ? detail.number : undefined,
        title,
        status,
        sourceBranch: optionalString(detail.sourceBranch) ?? '',
        targetBranch: optionalString(detail.targetBranch) ?? '',
        mergedAt: optionalString(detail.mergedAt),
        closedAt: optionalString(detail.closedAt),
        url: optionalString(detail.url),
    };
}

/** Sort key for newest-first ordering, read from the detail payload. */
function detailCreatedAt(detail: unknown): string | undefined {
    return isRecord(detail) ? optionalString(detail.createdAt) : undefined;
}

/** Seeds a freshly-unioned association as a loading row. */
function associationToLoadingItem(association: PrAssociation, repoId: string): PrStatusCardItem {
    return {
        key: association.key,
        repoId,
        number: association.number,
        state: 'loading',
        url: association.url,
    };
}

/** Maps the binding list response (a record keyed by prId) to the union's input shape. */
function bindingsFromResponse(bindings: Record<string, { taskId: string }> | undefined): PrChatBindingLike[] {
    if (!bindings) return [];
    return Object.entries(bindings).map(([prId, value]) => ({ prId, taskId: value.taskId }));
}

export function usePrChatStatusItems(options: UsePrChatStatusItemsOptions): UsePrChatStatusItemsResult {
    const { turns, workspaceId, remoteUrl, taskId } = options;
    const [items, setItems] = useState<PrStatusCardItem[]>([]);

    // Bump on every (re)run / cleanup so stale async callbacks no-op.
    const generationRef = useRef(0);
    // Latest unioned associations, so `retry` can re-fetch one by key.
    const associationsRef = useRef<PrAssociation[]>([]);

    const chatOriginId = useMemo(
        () => (workspaceId ? resolveCanonicalOriginId({ workspaceId, remoteUrl: remoteUrl ?? null }) : ''),
        [workspaceId, remoteUrl],
    );
    const detected = useMemo(() => gatherDetectedPrsFromTurns(turns), [turns]);
    // Only re-run the fetch pipeline when the *set* of detected PRs changes,
    // not on every streaming turn update.
    const detectedKey = useMemo(() => detected.map(pr => pr.url).sort().join('|'), [detected]);

    const fetchDetailForAssociation = useCallback(
        (association: PrAssociation, repoId: string, generation: number) => {
            setItems(prev =>
                prev.map(item =>
                    item.key === association.key ? { ...item, state: 'loading', error: undefined } : item,
                ),
            );
            getSpaCocClient()
                .pullRequests.getForOrigin(association.originId, association.prId, { workspaceId: repoId })
                .then(detail => {
                    if (generationRef.current !== generation) return;
                    const pr = mapPrDetailToCardPr(detail);
                    setItems(prev =>
                        prev.map(item => {
                            if (item.key !== association.key) return item;
                            if (!pr) {
                                return { ...item, state: 'error', error: 'Pull request details unavailable.' };
                            }
                            return {
                                ...item,
                                state: 'ready',
                                pr,
                                number: pr.number ?? item.number,
                                createdAt: detailCreatedAt(detail),
                            };
                        }),
                    );
                })
                .catch((err: unknown) => {
                    if (generationRef.current !== generation) return;
                    setItems(prev =>
                        prev.map(item =>
                            item.key === association.key
                                ? { ...item, state: 'error', error: getSpaCocClientErrorMessage(err, 'Failed to load pull request.') }
                                : item,
                        ),
                    );
                });
        },
        [],
    );

    useEffect(() => {
        if (!workspaceId || !chatOriginId) {
            associationsRef.current = [];
            setItems([]);
            return;
        }
        const generation = ++generationRef.current;
        const client = getSpaCocClient();

        (async () => {
            let bindings: PrChatBindingLike[] = [];
            try {
                const response = await client.pullRequests.listChatBindingsForOrigin(
                    chatOriginId,
                    taskId ? { taskId } : undefined,
                );
                bindings = bindingsFromResponse(response.bindings);
            } catch {
                // Bindings unavailable — detected PRs still surface.
                bindings = [];
            }
            if (generationRef.current !== generation) return;

            const associations = unionAssociations({ detected, bindings, workspaceId, chatOriginId });
            associationsRef.current = associations;

            // Persist freshly-detected PRs so they survive a reload with the
            // creating turn collapsed (AC-01 DoD #2). Best-effort.
            if (taskId) {
                for (const pending of detectedPrsNeedingBinding(detected, bindings, workspaceId, chatOriginId)) {
                    client.pullRequests
                        .createChatBindingForOrigin(pending.originId, pending.prId, taskId)
                        .catch(() => {
                            /* best-effort persistence */
                        });
                }
            }

            setItems(associations.map(association => associationToLoadingItem(association, workspaceId)));
            for (const association of associations) {
                fetchDetailForAssociation(association, workspaceId, generation);
            }
        })();

        return () => {
            // Invalidate this generation on dep change / unmount.
            generationRef.current++;
        };
    }, [workspaceId, chatOriginId, taskId, detectedKey, detected, fetchDetailForAssociation]);

    const retry = useCallback(
        (key: string) => {
            if (!workspaceId) return;
            const association = associationsRef.current.find(candidate => candidate.key === key);
            if (!association) return;
            fetchDetailForAssociation(association, workspaceId, generationRef.current);
        },
        [workspaceId, fetchDetailForAssociation],
    );

    return { items, retry };
}
