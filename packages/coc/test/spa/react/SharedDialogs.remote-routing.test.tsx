/**
 * @vitest-environment jsdom
 *
 * Regression tests: the SHARED dialogs must send their workspace-scoped REST
 * calls to the selected clone's OWN server, not the local origin.
 *
 * Bugs fixed here:
 *  - ResolveContextDialog fetched the `/skill` autocomplete list via the bare
 *    getSpaCocClient(). GET /workspaces/:id/skills/all resolves the workspace and
 *    404s, and the dialog swallows the error — a remote clone showed zero skills.
 *  - ModalJobAiControls read/wrote the `lastChatProvider` repo preference via the
 *    bare client. That route is keyed by id only (no workspace resolve), so it
 *    silently read from and wrote to the LOCAL server's preference file for a
 *    remote repo and the provider selector reset on every open.
 *  - The file-path hover preview picked its workspace by rootPath-prefix match
 *    over the LOCAL workspace list, so a remote clone's link either failed or
 *    previewed an arbitrary unrelated local repo. It now prefers the link's own
 *    `data-ws-id` and routes to that clone.
 *
 * A local (unregistered) workspace id must keep using the relative local origin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, waitFor, cleanup } from '@testing-library/react';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-remote-77';
const REMOTE_BASE = 'http://127.0.0.1:4101';
const LOCAL_WS = 'ws-local';

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn().mockReturnValue(false),
        selectSkill: vi.fn(),
        parseAndExtract: vi.fn((text: string) => ({ skills: [], prompt: text })),
        dismissMenu: vi.fn(),
    }),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// Also reads /workspaces/:id/preferences, but it is clone-routed separately via an
// explicit baseUrl argument. Stub it out so the assertions below see only the
// preference traffic ModalJobAiControls itself issues.
vi.mock('../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: () => ({ effectiveModel: undefined, effectiveModelName: undefined }),
}));

import { ResolveContextDialog } from '../../../src/server/spa/client/react/shared/ResolveContextDialog';
import { useModalJobAiSelection } from '../../../src/server/spa/client/react/shared/ModalJobAiControls';

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

describe('shared dialogs — remote-clone request routing', () => {
    let urls: string[];

    beforeEach(() => {
        resetCloneRegistryForTests();
        urls = [];
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
            urls.push(String(input));
            return Promise.resolve(jsonResponse({ merged: [], skills: [], providers: [], models: [] }));
        }));
    });

    afterEach(() => {
        cleanup();
        resetCloneRegistryForTests();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    const skillsUrl = (wsId: string) => urls.find(u => u.includes(`/workspaces/${wsId}/skills/all`));
    const prefsUrl = (wsId: string) => urls.find(u => u.includes(`/workspaces/${wsId}/preferences`));

    it('regression: ResolveContextDialog loads skills from the remote clone server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        render(
            <ResolveContextDialog
                open={true}
                onClose={vi.fn()}
                onSubmit={vi.fn()}
                commentCount={1}
                wsId={REMOTE_WS}
            />,
        );

        await waitFor(() => expect(skillsUrl(REMOTE_WS)).toBeTruthy());
        expect(skillsUrl(REMOTE_WS)!.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('ResolveContextDialog for a local (unregistered) workspace keeps the local origin', async () => {
        render(
            <ResolveContextDialog
                open={true}
                onClose={vi.fn()}
                onSubmit={vi.fn()}
                commentCount={1}
                wsId={LOCAL_WS}
            />,
        );

        await waitFor(() => expect(skillsUrl(LOCAL_WS)).toBeTruthy());
        expect(skillsUrl(LOCAL_WS)!.startsWith(REMOTE_BASE)).toBe(false);
    });

    it('regression: the modal job AI controls read the repo preference from the remote clone', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        renderHook(() => useModalJobAiSelection({ workspaceId: REMOTE_WS }));

        await waitFor(() => expect(prefsUrl(REMOTE_WS)).toBeTruthy());
        expect(prefsUrl(REMOTE_WS)!.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('the modal job AI controls write the provider preference back to the remote clone', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(() => useModalJobAiSelection({ workspaceId: REMOTE_WS }));
        await waitFor(() => expect(prefsUrl(REMOTE_WS)).toBeTruthy());

        result.current.setProvider('codex');

        await waitFor(() => {
            const writes = urls.filter(u => u.includes(`/workspaces/${REMOTE_WS}/preferences`));
            expect(writes.length).toBeGreaterThan(1);
        });
        for (const u of urls.filter(u => u.includes(`/workspaces/${REMOTE_WS}/preferences`))) {
            expect(u.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('the modal job AI controls for a local workspace keep the local origin', async () => {
        renderHook(() => useModalJobAiSelection({ workspaceId: LOCAL_WS }));

        await waitFor(() => expect(prefsUrl(LOCAL_WS)).toBeTruthy());
        expect(prefsUrl(LOCAL_WS)!.startsWith(REMOTE_BASE)).toBe(false);
    });
});

describe('file-path hover preview — remote-clone request routing', () => {
    const FULL_PATH = '/remote/host/repo/src/app.ts';

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        resetCloneRegistryForTests();
        document.body.innerHTML = '';
        delete (window as any).__COC_FILE_PATH_PREVIEW_DELEGATION__;
    });

    afterEach(() => {
        vi.useRealTimers();
        resetCloneRegistryForTests();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    /**
     * The local workspace list deliberately contains ONLY an unrelated repo whose
     * rootPath does not match: the old prefix heuristic fell through to
     * `workspaces[0]?.id` and previewed that repo instead.
     */
    function stubFetch(urls: string[]) {
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
            const url = String(input);
            urls.push(url);
            if (url.includes('/files/preview')) {
                return Promise.resolve(jsonResponse({
                    path: FULL_PATH,
                    fileName: 'app.ts',
                    lines: ['const value = 1;'],
                    totalLines: 1,
                    truncated: false,
                }));
            }
            return Promise.resolve(jsonResponse({
                workspaces: [{ id: 'ws-unrelated-local', rootPath: '/local/other-repo' }],
            }));
        }));
    }

    async function hover(link: HTMLElement) {
        link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(300);
        await Promise.resolve();
        await Promise.resolve();
    }

    it('regression: a link carrying data-ws-id previews from that clone, not an unrelated local repo', async () => {
        const urls: string[] = [];
        stubFetch(urls);
        // `vi.resetModules()` gives the dynamically-imported preview module a FRESH
        // cloneRegistry instance, so register on that same instance.
        const registry = await import('../../../src/server/spa/client/react/repos/cloneRegistry');
        registry.registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        document.body.innerHTML = `
            <div data-ws-id="${REMOTE_WS}">
                <span class="file-path-link" data-full-path="${FULL_PATH}">src/app.ts</span>
            </div>
        `;

        await import('../../../src/server/spa/client/react/shared/file-path/file-path-preview');
        await hover(document.querySelector('.file-path-link') as HTMLElement);

        const preview = urls.find(u => u.includes('/files/preview'));
        expect(preview).toBeTruthy();
        expect(preview).toContain(`/workspaces/${REMOTE_WS}/files/preview`);
        expect(preview!.startsWith(REMOTE_BASE)).toBe(true);
        // Never the unrelated local repo the rootPath heuristic would have picked.
        expect(urls.some(u => u.includes('ws-unrelated-local/files/preview'))).toBe(false);
    });

    it('a link with no data-ws-id keeps the local rootPath heuristic and the local origin', async () => {
        const urls: string[] = [];
        stubFetch(urls);
        // `vi.resetModules()` gives the dynamically-imported preview module a FRESH
        // cloneRegistry instance, so register on that same instance.
        const registry = await import('../../../src/server/spa/client/react/repos/cloneRegistry');
        registry.registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${FULL_PATH}">src/app.ts</span>
            </div>
        `;

        await import('../../../src/server/spa/client/react/shared/file-path/file-path-preview');
        await hover(document.querySelector('.file-path-link') as HTMLElement);

        const preview = urls.find(u => u.includes('/files/preview'));
        expect(preview).toBeTruthy();
        expect(preview).toContain('/workspaces/ws-unrelated-local/files/preview');
        expect(preview!.startsWith(REMOTE_BASE)).toBe(false);
    });
});
