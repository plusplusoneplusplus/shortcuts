/**
 * Per-clone request routing (AC-03).
 *
 * Resolves a clone (workspace) to its remote `baseUrl`, then hands callers a
 * CocClient routed to that clone — remote clones to their server's origin, local
 * clones to the default page origin. The source of truth is AC-01's remote
 * markers: a workspace tagged by `aggregateRemoteWorkspaces` carries
 * `{ remote, baseUrl }`; local workspaces carry neither (`isRemoteWorkspace`
 * distinguishes them).
 *
 * These are the PRIMITIVES; wiring them into individual tabs is AC-07.
 */

import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { useMemo } from 'react';
import { getCocClientFor } from '../api/cocClient';
import { cloneWsUrl } from '../api/wsUrl';
import { useRepos } from '../contexts/ReposContext';
import { isRemoteWorkspace } from './remoteWorkspaceAggregation';
import type { RepoData } from './repoGrouping';

/** A workspace object, or a bare workspace id. */
export type CloneRef = string | { id?: unknown; baseUrl?: unknown; remote?: unknown };

function refId(ref: CloneRef | undefined): string | undefined {
    if (ref === undefined || ref === null) return undefined;
    if (typeof ref === 'string') return ref || undefined;
    return typeof ref.id === 'string' ? ref.id : undefined;
}

/**
 * Resolve a clone's remote `baseUrl`, or `undefined` for a local clone.
 *
 * Accepts either a workspace object (checked directly via its remote marker) or
 * a workspace id (looked up in the supplied `repos` list). Pure — no React, no
 * context access — so it is unit-testable and reusable from non-React code.
 */
export function resolveCloneBaseUrl(ref: CloneRef | undefined, repos: RepoData[] = []): string | undefined {
    // Direct object with a remote marker — trust it without a lookup.
    if (ref && typeof ref === 'object' && isRemoteWorkspace(ref)) {
        return ref.baseUrl;
    }
    const id = refId(ref);
    if (!id) return undefined;

    const match = repos.find(r => r.workspace?.id === id);
    if (match && isRemoteWorkspace(match.workspace)) {
        return match.workspace.baseUrl;
    }
    return undefined;
}

// ── React hooks ──────────────────────────────────────────────────────────────

/**
 * Hook returning a resolver bound to the live ReposContext repo list, so callers
 * can map a workspace id → its remote baseUrl (or undefined when local).
 */
export function useResolveCloneBaseUrl(): (ref: CloneRef | undefined) => string | undefined {
    const { repos } = useRepos();
    return useMemo(() => (ref: CloneRef | undefined) => resolveCloneBaseUrl(ref, repos), [repos]);
}

/**
 * Hook returning the CocClient for a given clone: routed to the clone's remote
 * server when it is remote, else the default origin client. Pass `undefined` to
 * always get the default client.
 */
export function useCocClient(ref?: CloneRef): CocClient {
    const { repos } = useRepos();
    const baseUrl = resolveCloneBaseUrl(ref, repos);
    return useMemo(() => getCocClientFor(baseUrl), [baseUrl]);
}

/**
 * Hook returning a `cloneWsUrl`-style builder pre-bound to a clone's baseUrl:
 * `buildWsUrl(path)` yields a remote ws(s) URL for a remote clone, or the
 * legacy page-origin URL for a local clone. AC-07 wires this into the WS hooks.
 */
export function useCloneWsUrl(ref?: CloneRef): (path: string) => string {
    const { repos } = useRepos();
    const baseUrl = resolveCloneBaseUrl(ref, repos);
    return useMemo(() => (path: string) => cloneWsUrl(path, baseUrl), [baseUrl]);
}
