import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    openContentSearchMatch,
    type ContentSearchOpenDependencies,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchOpen';
import type { ContentSearchOverlayMatch } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlay';

const GROUP = 'group-stack';
const CHAT = 'chat-a';

function match(overrides: Partial<ContentSearchOverlayMatch> = {}): ContentSearchOverlayMatch {
    return {
        id: 'member-a src/app.ts 7 0',
        workspaceId: 'member-a',
        routingRef: null,
        repoLabel: 'API',
        path: 'src/app.ts',
        line: 7,
        preview: 'needle',
        ...overrides,
    };
}

function dependencies(overrides: Partial<ContentSearchOpenDependencies> = {}) {
    const deps = {
        getGroup: vi.fn(async () => ({
            id: GROUP,
            name: 'Stack',
            members: [{ workspaceId: 'member-a', stale: false, name: 'Fresh API', readOnly: false }],
        })),
        hasWorkspaceRoute: vi.fn(() => true),
        resolveRoute: vi.fn(() => ({ kind: 'local' as const })),
        readBlob: vi.fn(async () => ({ content: 'needle', encoding: 'utf8' as const })),
        openPreview: vi.fn(() => 'tab-id'),
        ...overrides,
    } as ContentSearchOpenDependencies;
    return deps;
}

describe('openContentSearchMatch', () => {
    beforeEach(() => {
        window.location.hash = '#repos/group-stack/chats';
        localStorage.clear();
    });

    it('preflights and opens a repository result at its line through the preview slot', async () => {
        const deps = dependencies();
        const outcome = await openContentSearchMatch({
            panelWorkspaceId: 'repo-a',
            scope: 'repo',
            chatId: CHAT,
            match: match({ workspaceId: 'repo-a', routingRef: null }),
        }, deps);

        expect(outcome).toEqual({ opened: true });
        expect(deps.getGroup).not.toHaveBeenCalled();
        expect(deps.readBlob).toHaveBeenCalledWith('repo-a', 'src/app.ts', {}, null);
        expect(deps.openPreview).toHaveBeenCalledWith('repo-a', expect.objectContaining({
            ownerWorkspaceId: 'repo-a',
            ownerRoutingRef: null,
            chatId: CHAT,
            resourceId: 'src/app.ts',
            line: 7,
        }));
    });

    it('keeps group scope while qualifying equal member ids with the group owner route', async () => {
        const deps = dependencies({
            resolveRoute: vi.fn(() => ({ kind: 'remote', baseUrl: 'https://alpha.test' })),
        });
        const outcome = await openContentSearchMatch({
            panelWorkspaceId: GROUP,
            scope: 'group',
            chatId: CHAT,
            groupBaseUrl: 'https://alpha.test',
            match: match({ routingRef: 'remote:server-alpha:group-stack' }),
        }, deps);

        expect(outcome).toEqual({ opened: true });
        expect(deps.hasWorkspaceRoute).toHaveBeenCalledWith('member-a', 'https://alpha.test');
        expect(deps.readBlob).toHaveBeenCalledWith(
            'member-a',
            'src/app.ts',
            {},
            'remote:server-alpha:member-a',
        );
        expect(deps.openPreview).toHaveBeenCalledWith(GROUP, expect.objectContaining({
            ownerWorkspaceId: 'member-a',
            ownerRoutingRef: 'remote:server-alpha:member-a',
            repoLabel: 'Fresh API',
            resourceId: 'src/app.ts',
            line: 7,
        }));
        expect(window.location.hash).toBe('#repos/group-stack/chats');
    });

    it('leaves the page and panel untouched when membership is stale', async () => {
        const openPreview = vi.fn(() => 'tab-id');
        const readBlob = vi.fn(async () => ({ content: '', encoding: 'utf8' as const }));
        const deps = dependencies({
            getGroup: vi.fn(async () => ({
                id: GROUP,
                name: 'Stack',
                members: [{ workspaceId: 'member-a', stale: true, readOnly: false }],
            })),
            readBlob,
            openPreview,
        });
        localStorage.setItem('sentinel-tabs', 'unchanged');

        const outcome = await openContentSearchMatch({
            panelWorkspaceId: GROUP,
            scope: 'group',
            chatId: CHAT,
            match: match(),
        }, deps);

        expect(outcome).toEqual({
            opened: false,
            error: 'This repository is no longer available in the group. Run the search again.',
        });
        expect(readBlob).not.toHaveBeenCalled();
        expect(openPreview).not.toHaveBeenCalled();
        expect(localStorage.getItem('sentinel-tabs')).toBe('unchanged');
        expect(window.location.hash).toBe('#repos/group-stack/chats');
    });

    it('does not open or mutate panel state when the file disappeared', async () => {
        const openPreview = vi.fn(() => 'tab-id');
        const deps = dependencies({
            readBlob: vi.fn(async () => { throw new Error('404'); }),
            openPreview,
        });

        const outcome = await openContentSearchMatch({
            panelWorkspaceId: 'repo-a',
            scope: 'repo',
            chatId: null,
            match: match({ workspaceId: 'repo-a' }),
        }, deps);

        expect(outcome).toEqual({
            opened: false,
            error: 'This file is no longer available. Run the search again.',
        });
        expect(openPreview).not.toHaveBeenCalled();
    });

    it('refuses an unresolved remote owner before a request can fall back locally', async () => {
        const readBlob = vi.fn(async () => ({ content: '', encoding: 'utf8' as const }));
        const deps = dependencies({
            resolveRoute: vi.fn(() => ({ kind: 'unresolved-remote' as const })),
            readBlob,
        });

        const outcome = await openContentSearchMatch({
            panelWorkspaceId: 'repo-a',
            scope: 'repo',
            chatId: null,
            match: match({
                workspaceId: 'repo-a',
                routingRef: 'remote:offline:repo-a',
            }),
        }, deps);

        expect(outcome.opened).toBe(false);
        expect(readBlob).not.toHaveBeenCalled();
        expect(deps.openPreview).not.toHaveBeenCalled();
    });

    it('does not mutate panel state when activation is cancelled during membership refresh', async () => {
        let resolveGroup!: (group: Awaited<ReturnType<ContentSearchOpenDependencies['getGroup']>>) => void;
        const getGroup = vi.fn(() => new Promise<Awaited<ReturnType<ContentSearchOpenDependencies['getGroup']>>>(
            resolve => { resolveGroup = resolve; },
        ));
        const deps = dependencies({ getGroup });
        const controller = new AbortController();
        const opening = openContentSearchMatch({
            panelWorkspaceId: GROUP,
            scope: 'group',
            chatId: CHAT,
            signal: controller.signal,
            match: match(),
        }, deps);

        controller.abort();
        resolveGroup({
            id: GROUP,
            name: 'Stack',
            members: [{ workspaceId: 'member-a', stale: false, readOnly: false }],
        });

        expect(await opening).toEqual({ opened: false, error: 'Opening this result was cancelled.' });
        expect(deps.readBlob).not.toHaveBeenCalled();
        expect(deps.openPreview).not.toHaveBeenCalled();
    });
});
