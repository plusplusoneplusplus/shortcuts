/**
 * prChatAssociation — client-side union of the pull requests a chat created
 * (AC-01, client half).
 *
 * The PRs shown for a chat = the union of:
 *   - PRs detected in the currently-loaded turns, and
 *   - persisted bindings for the chat's `task_id`.
 *
 * Detection reuses {@link detectPullRequestsInToolGroup} (no new PR-URL regex).
 * Canonical origin ids reuse {@link resolveCanonicalOriginId} (no duplicate
 * origin logic) by synthesizing the repo's canonical remote URL from a detected
 * PR's provider/owner/repo (GitHub) or organization/project (Azure DevOps). The
 * synthesized origin matches the chat workspace's origin for PRs created in the
 * chat's own repo, so a detected PR and its later-persisted binding merge into a
 * single association.
 *
 * This module is intentionally pure (no React, no I/O) so the union logic is
 * deterministically testable; the data hook layers fetching on top of it.
 */
import type { ClientConversationTurn } from '../../../types/dashboard';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import {
    collectToolCallsFromTurns,
    detectPullRequestsInToolGroup,
    syntheticRemoteUrlForDetectedPr,
    type DetectedPullRequest,
} from '@plusplusoneplusplus/forge/git/pull-request-detection';

/** Minimal binding shape (subset of `PullRequestChatBinding`) the union needs. */
export interface PrChatBindingLike {
    prId: string;
    taskId?: string;
}

/** A pull request associated with the current chat, after the union. */
export interface PrAssociation {
    /** Stable React key / identity, `${originId}:${prId}`. */
    key: string;
    /** Canonical origin scoping the PR and its binding. */
    originId: string;
    /** PR id (number as a string) used by the REST + binding endpoints. */
    prId: string;
    /** Numeric PR number for display. */
    number: number;
    /** Web URL from detection — fallback external link before detail loads. */
    url?: string;
    /** Detection provider, when known. */
    provider?: DetectedPullRequest['provider'];
    /** Where this association came from (a PR can be in both). */
    sources: Array<'detected' | 'binding'>;
}

/**
 * Detects every pull request created in the loaded turns by scanning their tool
 * calls with the shared {@link detectPullRequestsInToolGroup}. URLs are
 * de-duplicated across the whole conversation. Pass the chat workspace's
 * `remoteUrl` to scope detections to the chat's own repo.
 */
export function gatherDetectedPrsFromTurns(
    turns: readonly ClientConversationTurn[] | undefined,
    remoteUrl?: string | null,
): DetectedPullRequest[] {
    return detectPullRequestsInToolGroup(collectToolCallsFromTurns(turns), { remoteUrl });
}

/**
 * Resolves the canonical origin id for a detected PR, reusing
 * {@link resolveCanonicalOriginId}. Returns null when the provider/fields are
 * insufficient (so callers skip PRs that cannot be fetched or deep-linked).
 */
export function originIdForDetectedPr(pr: DetectedPullRequest, workspaceId: string): string | null {
    const remoteUrl = syntheticRemoteUrlForDetectedPr(pr);
    if (!remoteUrl) return null;
    return resolveCanonicalOriginId({ workspaceId, remoteUrl });
}

export interface UnionAssociationsInput {
    detected: readonly DetectedPullRequest[];
    bindings: readonly PrChatBindingLike[];
    /** The chat's workspace id (origin resolution + binding scope). */
    workspaceId: string;
    /** Canonical origin of the chat's own workspace (scopes the bindings). */
    chatOriginId: string;
}

/**
 * Builds the union of detected PRs and persisted bindings, both keyed by the
 * chat's own origin, so a PR present in both collapses to one association whose
 * `sources` lists both. Detected PRs with no resolvable origin — or one that is
 * not the chat's own — are skipped.
 * Order is stable: detected (turn order) first, then binding-only entries.
 */
export function unionAssociations(input: UnionAssociationsInput): PrAssociation[] {
    const { detected, bindings, workspaceId, chatOriginId } = input;
    const byKey = new Map<string, PrAssociation>();
    const order: string[] = [];

    const upsert = (candidate: PrAssociation, source: 'detected' | 'binding'): void => {
        const existing = byKey.get(candidate.key);
        if (existing) {
            if (!existing.sources.includes(source)) existing.sources.push(source);
            if (!existing.url && candidate.url) existing.url = candidate.url;
            if (!existing.provider && candidate.provider) existing.provider = candidate.provider;
            if (!existing.number && candidate.number) existing.number = candidate.number;
            return;
        }
        byKey.set(candidate.key, { ...candidate, sources: [source] });
        order.push(candidate.key);
    };

    for (const pr of detected) {
        const originId = originIdForDetectedPr(pr, workspaceId);
        // A detected PR from another repo is not this chat's PR: rendering it
        // under its own synthesized origin is how a foreign PR used to get a
        // banner (and, via `detectedPrsNeedingBinding`, nearly a binding).
        if (!originId || originId !== chatOriginId) continue;
        const prId = String(pr.number);
        upsert(
            { key: `${originId}:${prId}`, originId, prId, number: pr.number, url: pr.url, provider: pr.provider, sources: [] },
            'detected',
        );
    }

    for (const binding of bindings) {
        if (!binding.prId) continue;
        const prId = String(binding.prId);
        const parsed = Number.parseInt(prId, 10);
        upsert(
            { key: `${chatOriginId}:${prId}`, originId: chatOriginId, prId, number: Number.isNaN(parsed) ? 0 : parsed, sources: [] },
            'binding',
        );
    }

    return order.map(key => byKey.get(key)!);
}

/**
 * Detected PRs that belong to the chat's own origin and are not yet persisted as
 * bindings — these should be upserted (POST) so they survive a reload with the
 * creating turn collapsed/trimmed. PRs in a different repo than the chat are
 * excluded because their binding would be scoped to a different origin.
 */
export function detectedPrsNeedingBinding(
    detected: readonly DetectedPullRequest[],
    bindings: readonly PrChatBindingLike[],
    workspaceId: string,
    chatOriginId: string,
): Array<{ originId: string; prId: string; number: number }> {
    const bound = new Set(bindings.map(binding => String(binding.prId)));
    const seen = new Set<string>();
    const out: Array<{ originId: string; prId: string; number: number }> = [];
    for (const pr of detected) {
        const originId = originIdForDetectedPr(pr, workspaceId);
        if (!originId || originId !== chatOriginId) continue;
        const prId = String(pr.number);
        if (bound.has(prId) || seen.has(prId)) continue;
        seen.add(prId);
        out.push({ originId, prId, number: pr.number });
    }
    return out;
}
