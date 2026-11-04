import { useCallback, useEffect, useRef, useState } from 'react';
import { browseWorkspaceFolders, getRepositoryApiErrorMessage } from './repositoryService';
import { describeServerFailure, type ServerSelection } from './useServerSelection';
import { getCurrentAgentId, setCurrentAgentId } from '../utils/config';
import { isRecord } from '../utils/typeGuards';
import type { BrowseWorkspaceFoldersResponse } from '@plusplusoneplusplus/coc-client';

export type BrowserResponse = BrowseWorkspaceFoldersResponse;
export type BrowserEntry = NonNullable<BrowserResponse['entries']>[number];

function isBrowserResponse(value: unknown): value is BrowserResponse {
    return isRecord(value)
        && typeof value.path === 'string'
        && (value.parent === undefined || value.parent === null || typeof value.parent === 'string')
        && (value.entries === undefined || (Array.isArray(value.entries) && value.entries.every(entry =>
            isRecord(entry) && typeof entry.name === 'string'
                && (entry.type === undefined || typeof entry.type === 'string')
                && (entry.isGitRepo === undefined || typeof entry.isGitRepo === 'boolean'))))
        && (value.drives === undefined || (Array.isArray(value.drives) && value.drives.every(drive => typeof drive === 'string')))
        && (value.browseRoots === undefined || (Array.isArray(value.browseRoots) && value.browseRoots.every(root =>
            isRecord(root) && typeof root.label === 'string' && typeof root.path === 'string')));
}

export function getPathLeaf(path: string): string {
    return path.replace(/[/\\]+$/, '').split(/[/\\]+/).filter(Boolean).pop() || '';
}

export function joinBrowserPath(base: string, child: string): string {
    if (!base) return child;
    if (/[/\\]$/.test(base)) return `${base}${child}`;
    return `${base}${base.includes('\\') ? '\\' : '/'}${child}`;
}

interface Options {
    open: boolean;
    server: ServerSelection;
    /** Only add dialogs support container agents; a remote target bypasses them. */
    agent?: { id: string; address?: string };
    onSelect?: (data: BrowserResponse) => void;
    formatError?: (error: unknown) => string;
}

function browserOwner(server: ServerSelection['selected'], agentId?: string): string {
    return JSON.stringify([server.id, server.baseUrl, server.baseUrl ? undefined : agentId]);
}

const emptyBrowser = () => ({
    browserPath: '',
    browserEntries: [] as BrowserEntry[],
    browserParent: null as string | null,
    browserLoading: false,
    browserDrives: [] as string[],
    browseRoots: [] as Array<{ label: string; path: string }>,
    browserError: null as string | null,
});

/** Owns one dialog's filesystem reads, including stale reads and auth callbacks. */
export function useRepositoryFolderBrowser(options: Options) {
    const [state, setState] = useState(emptyBrowser);
    const latest = useRef(options);
    const sequence = useRef(0);
    const activeRequest = useRef<{ generation: number; owner: string; awaitingOwner: boolean } | null>(null);
    const lastDirectory = useRef<string | null>(null);
    const previousAgentId = useRef(options.agent?.id);
    const authCleanup = useRef<(() => void) | null>(null);
    const previousOwner = browserOwner(latest.current.server.selected, latest.current.agent?.id);
    const owner = browserOwner(options.server.selected, options.agent?.id);
    if (latest.current.open !== options.open || previousOwner !== owner) {
        const request = activeRequest.current;
        const wasCurrent = request?.generation === sequence.current;
        sequence.current++;
        // A server dropdown starts its new read before React commits the selection.
        // Only that explicitly targeted read may cross its one expected owner change.
        if (options.open && latest.current.open && wasCurrent && request?.awaitingOwner && request.owner === owner) {
            request.generation = sequence.current;
            request.awaitingOwner = false;
        }
    }
    latest.current = options;

    const resetBrowser = useCallback(() => {
        sequence.current++;
        lastDirectory.current = null;
        authCleanup.current?.();
        authCleanup.current = null;
        setState(emptyBrowser());
    }, []);

    useEffect(() => {
        if (!options.open) resetBrowser();
        return () => {
            sequence.current++;
            authCleanup.current?.();
            authCleanup.current = null;
        };
    }, [options.open, resetBrowser]);

    const navigateTo = useCallback(async (dir: string, targetServerId?: string) => {
        const { server, agent } = latest.current;
        const target = server.resolveServer(targetServerId ?? server.serverId);
        lastDirectory.current = dir;
        const owner = browserOwner(target, agent?.id);
        const request = {
            generation: ++sequence.current,
            owner,
            awaitingOwner: owner !== browserOwner(server.selected, agent?.id),
        };
        activeRequest.current = request;
        authCleanup.current?.();
        authCleanup.current = null;
        const current = () => {
            const selected = latest.current.server.selected;
            return latest.current.open && request.generation === sequence.current
                && selected.id === target.id && selected.baseUrl === target.baseUrl
                && (!!target.baseUrl || latest.current.agent?.id === agent?.id);
        };
        const apply = (data: BrowserResponse) => {
            if (!current()) return;
            lastDirectory.current = data.path || dir;
            setState({
                browserPath: data.path,
                browserEntries: data.entries || [],
                browserParent: data.parent || null,
                browserLoading: false,
                browserDrives: Array.isArray(data.drives) ? data.drives : [],
                browseRoots: Array.isArray(data.browseRoots) ? data.browseRoots : [],
                browserError: null,
            });
            latest.current.onSelect?.(data);
        };
        setState(prev => ({ ...prev, browserLoading: true, browserError: null }));
        const previousAgent = getCurrentAgentId();
        try {
            if (!target.baseUrl && agent?.id) setCurrentAgentId(agent.id);
            apply(await browseWorkspaceFolders(dir, target.baseUrl));
        } catch (error) {
            if (!current()) return;
            const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
            const message = error instanceof Error ? error.message : String(error);
            const authError = status === 401 || status === 403
                || /unexpected.*token|not valid json|authentication required/i.test(message);
            let browserError = describeServerFailure(
                latest.current.formatError?.(error)
                    ?? getRepositoryApiErrorMessage(error, 'Unable to browse this path'),
                target,
            );
            if (!target.baseUrl && agent?.id && authError) {
                browserError = 'Authentication required. Please authenticate with this agent first.';
                if (agent.address) {
                    browserError = 'Authenticating — complete login in the opened tab if prompted...';
                    const agentOrigin = new URL(agent.address).origin;
                    const popup = window.open(`${agent.address}/api/fs/browse-helper?path=${encodeURIComponent(dir)}`, '_blank', 'width=600,height=400');
                    const onMessage = (event: MessageEvent<unknown>) => {
                        if (!current() || !popup || event.origin !== agentOrigin || event.source !== popup) return;
                        authCleanup.current?.();
                        authCleanup.current = null;
                        const payload = event.data;
                        if (isRecord(payload) && payload.type === 'browse-result' && isBrowserResponse(payload.data)) {
                            apply(payload.data);
                        } else {
                            const message = isRecord(payload) && payload.type === 'browse-error' && typeof payload.error === 'string'
                                ? payload.error
                                : 'Invalid browser response';
                            setState(prev => ({ ...prev, browserError: `Browse failed: ${message}`, browserLoading: false }));
                        }
                    };
                    window.addEventListener('message', onMessage);
                    const interval = window.setInterval(() => {
                        if (popup?.closed || !current()) {
                            authCleanup.current?.();
                            authCleanup.current = null;
                        }
                    }, 1000);
                    const timeout = window.setTimeout(() => {
                        authCleanup.current?.();
                        authCleanup.current = null;
                    }, 300_000);
                    authCleanup.current = () => {
                        window.removeEventListener('message', onMessage);
                        window.clearInterval(interval);
                        window.clearTimeout(timeout);
                    };
                }
            }
            setState(prev => ({ ...prev, browserEntries: [], browserParent: null, browseRoots: [], browserError }));
        } finally {
            if (!target.baseUrl && agent?.id) setCurrentAgentId(previousAgent);
            if (current()) setState(prev => ({ ...prev, browserLoading: false }));
        }
    }, []);

    useEffect(() => {
        const changed = previousAgentId.current !== options.agent?.id;
        previousAgentId.current = options.agent?.id;
        if (!changed || !options.open || options.server.selected.baseUrl || lastDirectory.current === null) return;
        const directory = lastDirectory.current;
        resetBrowser();
        void navigateTo(directory);
    }, [options.agent?.id, options.open, options.server.selected.baseUrl, navigateTo, resetBrowser]);

    return { ...state, navigateTo, resetBrowser };
}

export type RepositoryFolderBrowser = ReturnType<typeof useRepositoryFolderBrowser>;
