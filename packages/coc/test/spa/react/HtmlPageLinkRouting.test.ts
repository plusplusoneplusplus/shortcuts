/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { remoteWorkspaces, flagEnabled } = vi.hoisted(() => ({
    remoteWorkspaces: [] as Array<{ id: string; rootPath: string; baseUrl: string; remote: object }>,
    flagEnabled: vi.fn(() => true),
}));

vi.mock('../../../src/server/spa/client/react/repos/workspacesWithRemote', () => ({
    withRemoteWorkspaces: (local: unknown[]) => [...local, ...remoteWorkspaces],
}));
vi.mock('../../../src/server/spa/client/react/utils/config', async (importOriginal) => ({
    ...await importOriginal<object>(),
    isHtmlPageTabEnabled: flagEnabled,
}));

const root = '/workspace/repo';
const htmlPath = `${root}/pages/index.html`;

async function setup(options: {
    path?: string;
    desktop?: boolean;
    workspaces?: Array<{ id: string; rootPath: string }>;
    response?: { ok: true } | { ok: false; reason: string };
    groupPreview?: { path: string; resolvedWorkspaceId: string };
} = {}) {
    const path = options.path ?? htmlPath;
    document.body.innerHTML = `<div class="chat-message assistant" data-ws-id="${options.groupPreview ? 'group-one' : 'ws-local'}">
        <a href="${path}">Open page</a>
    </div>`;
    const open = vi.fn().mockResolvedValue(options.response ?? { ok: true });
    if (options.desktop !== false) {
        Object.defineProperty(window, 'cocDesktop', {
            value: { isDesktop: true, htmlPage: { open } },
            configurable: true,
        });
    }
    const fetch = vi.fn()
        .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ workspaces: options.workspaces ?? [{ id: 'ws-local', rootPath: root }] }),
        });
    if (options.groupPreview) {
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => options.groupPreview,
        });
    }
    vi.stubGlobal('fetch', fetch);
    await import('../../../src/server/spa/client/react/shared/file-path/file-path-preview');
    const events: CustomEvent[] = [];
    const collect = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('coc-open-html-page', collect);
    window.addEventListener('coc-open-source-canvas', collect);
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(events.length).toBe(1));
    window.removeEventListener('coc-open-html-page', collect);
    window.removeEventListener('coc-open-source-canvas', collect);
    return { events, open, fetch };
}

describe('assistant HTML link routing', () => {
    beforeEach(() => {
        vi.resetModules();
        flagEnabled.mockReturnValue(true);
        remoteWorkspaces.length = 0;
        document.body.replaceWith(document.createElement('body'));
        delete (window as { __COC_FILE_PATH_PREVIEW_DELEGATION__?: boolean }).__COC_FILE_PATH_PREVIEW_DELEGATION__;
        delete (window as { cocDesktop?: unknown }).cocDesktop;
        vi.stubGlobal('crypto', { randomUUID: () => 'page-id' });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
        delete (window as { cocDesktop?: unknown }).cocDesktop;
    });

    it('opens a local existing .html page using the resolved absolute path', async () => {
        const { events, open } = await setup({ path: 'pages/index.html' });
        expect(open).toHaveBeenCalledWith('page-id', htmlPath);
        expect(events[0].type).toBe('coc-open-html-page');
        expect(events[0].detail).toEqual({ pageId: 'page-id', filePath: htmlPath, wsId: 'ws-local' });
    });

    it('resolves a repo-group relative link to its owning local member', async () => {
        const { events, open } = await setup({
            path: 'pages/index.htm',
            workspaces: [{ id: 'group-one', rootPath: '/workspace' }, { id: 'ws-local', rootPath: root }],
            groupPreview: { path: `${root}/pages/index.htm`, resolvedWorkspaceId: 'ws-local' },
        });
        expect(open).toHaveBeenCalledWith('page-id', `${root}/pages/index.htm`);
        expect(events[0].detail.wsId).toBe('ws-local');
    });

    it('keeps the source viewer in the browser', async () => {
        const { events, open } = await setup({ desktop: false });
        expect(open).not.toHaveBeenCalled();
        expect(events[0].type).toBe('coc-open-source-canvas');
    });

    it('keeps remote workspace links in the source viewer', async () => {
        remoteWorkspaces.push({
            id: 'ws-remote', rootPath: '/remote/repo', baseUrl: 'http://localhost:4001', remote: {},
        });
        const { events, open } = await setup({
            path: '/remote/repo/index.html',
            workspaces: [],
        });
        expect(open).not.toHaveBeenCalled();
        expect(events[0].type).toBe('coc-open-source-canvas');
    });

    it('does not mistake an ambiguous local/remote workspace id for a local page', async () => {
        remoteWorkspaces.push({
            id: 'ws-local', rootPath: root, baseUrl: 'http://localhost:4001', remote: {},
        });
        const { events, open } = await setup();
        expect(open).not.toHaveBeenCalled();
        expect(events[0].type).toBe('coc-open-source-canvas');
    });

    it('falls back to the source viewer when the desktop file is missing', async () => {
        const { events, open } = await setup({ response: { ok: false, reason: 'missing' } });
        expect(open).toHaveBeenCalledOnce();
        expect(events[0].type).toBe('coc-open-source-canvas');
        expect(events[0].detail.filePath).toBe(htmlPath);
    });

    it('respects the live feature flag', async () => {
        flagEnabled.mockReturnValue(false);
        const { events, open } = await setup();
        expect(open).not.toHaveBeenCalled();
        expect(events[0].type).toBe('coc-open-source-canvas');
    });

    it('leaves non-html links unchanged', async () => {
        const { events, open } = await setup({ path: `${root}/index.ts` });
        expect(open).not.toHaveBeenCalled();
        expect(events[0].type).toBe('coc-open-source-canvas');
    });
});
