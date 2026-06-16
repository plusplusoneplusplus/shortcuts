/**
 * Per-workspace clone→baseUrl LOOKUP registry (AC-07).
 *
 * AC-03 gives React code `useCocClient(ref)` / `useCloneWsUrl(ref)`, which resolve
 * a clone's remote `baseUrl` from the live ReposContext. But plain (non-React)
 * services — `explorerApi`, `notesApi`, schedules/work-item/PR call sites — only
 * receive a bare `workspaceId` and call `getSpaCocClient()` directly; they have no
 * access to React context. This module is the seam for them.
 *
 * It holds a module-level `workspaceId → baseUrl` map covering REMOTE workspaces
 * only. AC-01's `aggregateRemoteWorkspaces` populates it every refresh (so the
 * registry tracks devtunnel port reassignment). Services resolve the right client
 * via `getCocClientForWorkspace(workspaceId)`.
 *
 * Crucially this is a per-workspace LOOKUP, NOT a global mutable "active baseUrl"
 * override:
 *   • A LOCAL workspace id is absent from the map → `lookupCloneBaseUrl` returns
 *     `undefined` → `getCocClientFor(undefined)` → the EXISTING default
 *     `getSpaCocClient()` singleton. Local clones are byte-for-byte unchanged.
 *   • A REMOTE workspace id resolves to its server's effectiveUrl → a cached
 *     CocClient pinned to that origin. A remote clone therefore NEVER falls
 *     through to the local server ("no local fallthrough" guarantee): its
 *     clone-scoped REST/WS always targets the remote `baseUrl`.
 *
 * The repos-list / git-info AGGREGATION itself is never rerouted through here —
 * it keeps using the default client (AC-01 owns its own self-contained remote
 * fetch). This registry only serves per-clone, workspace-scoped tab data.
 */

import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClient, toSpaCocRequestOptions, translateSpaCocClientError } from '../api/cocClient';
import { cloneWsUrl } from '../api/wsUrl';
import { getApiBase } from '../utils/config';

/** workspaceId → remote baseUrl. Remote workspaces only; local ids are absent. */
const cloneBaseUrlByWorkspace = new Map<string, string>();

/** A minimal remote-workspace shape: just the routing essentials. */
export interface CloneRegistryEntry {
    workspaceId: string;
    baseUrl: string;
}

/**
 * Replace the registry's remote entries with `entries` (remote workspaces only).
 *
 * A full replace — not a merge — so a server that drops a workspace (or goes
 * away entirely) stops resolving to a stale baseUrl. Called by AC-01's
 * aggregation on every repo refresh, so the map always mirrors the current set
 * of reachable/cached remote clones (and follows devtunnel port reassignment).
 */
export function registerCloneBaseUrls(entries: Iterable<CloneRegistryEntry>): void {
    cloneBaseUrlByWorkspace.clear();
    for (const { workspaceId, baseUrl } of entries) {
        if (workspaceId && baseUrl) {
            cloneBaseUrlByWorkspace.set(workspaceId, baseUrl);
        }
    }
}

/**
 * Look up a workspace's remote `baseUrl`, or `undefined` when it is a LOCAL
 * workspace (or unknown). Local/unknown ids deliberately resolve to `undefined`
 * so downstream `getCocClientFor(undefined)` returns the default local client.
 */
export function lookupCloneBaseUrl(workspaceId: string | null | undefined): string | undefined {
    if (!workspaceId) return undefined;
    return cloneBaseUrlByWorkspace.get(workspaceId);
}

/**
 * Resolve the CocClient for a workspace id: the remote-routed client for a remote
 * clone, else the default page-origin client. The single entry point services use
 * in place of `getSpaCocClient()` so their workspace-scoped calls follow the clone.
 */
export function getCocClientForWorkspace(workspaceId: string | null | undefined): CocClient {
    const baseUrl = lookupCloneBaseUrl(workspaceId);
    // Local clone: call getSpaCocClient() directly (not getCocClientFor(undefined))
    // so this is identical to the pre-AC-07 code path — byte-for-byte unchanged.
    return baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient();
}

/**
 * Fetch a RELATIVE API `url` (e.g. `/workspaces/ws-x/git/changes/...`) against a
 * workspace's clone — the non-hook seam for the git diff-viewing layer, whose
 * `DiffSource` factories build a bare path string and then need to fetch it.
 *
 *   • Local clone  → the default client: `'' + getApiBase() + url`. This is the
 *     EXACT path `fetchApi(url)` (→ `requestSpaApi`) takes today, so local clones
 *     stay byte-for-byte unchanged.
 *   • Remote clone → its client: `${baseUrl}${apiBase}${url}` (apiBase = `/api`).
 *
 * Error translation mirrors `requestSpaApi` so callers see the same `Error`
 * shape they did before routing was introduced.
 */
export async function requestForWorkspace<T = unknown>(
    workspaceId: string | null | undefined,
    url: string,
    options?: RequestInit,
): Promise<T> {
    try {
        return await getCocClientForWorkspace(workspaceId).request<T>(url, toSpaCocRequestOptions(options));
    } catch (error) {
        translateSpaCocClientError(error);
    }
}

/**
 * Absolute REST API base for a workspace's clone, suitable for call sites that
 * build a URL by hand instead of going through CocClient (e.g. the `EventSource`
 * process stream, which cannot use the client's fetch).
 *
 *   • Remote clone → `${baseUrl}${apiBasePath}` (e.g. `http://127.0.0.1:4000/api`).
 *   • Local clone  → `getApiBase()` (unchanged; honors container agent prefix).
 *
 * Remote CoC servers are never in container mode, so the agent prefix is not
 * applied to the remote base — it uses the plain configured `apiBasePath`.
 */
export function cloneApiBase(workspaceId: string | null | undefined): string {
    const baseUrl = lookupCloneBaseUrl(workspaceId);
    if (!baseUrl) {
        return getApiBase();
    }
    const apiBasePath = (globalThis as { window?: { __DASHBOARD_CONFIG__?: { apiBasePath?: string } } })
        .window?.__DASHBOARD_CONFIG__?.apiBasePath ?? '/api';
    return baseUrl.replace(/\/+$/, '') + apiBasePath;
}

/**
 * Build a WebSocket URL for `path`, routed to a workspace's clone when remote and
 * to the page origin when local. Convenience wrapper over `cloneWsUrl` for
 * non-hook call sites that have only a `workspaceId`.
 */
export function cloneWsUrlForWorkspace(path: string, workspaceId: string | null | undefined): string {
    return cloneWsUrl(path, lookupCloneBaseUrl(workspaceId));
}

/** Test-only: clear the registry between cases. */
export function resetCloneRegistryForTests(): void {
    cloneBaseUrlByWorkspace.clear();
}
