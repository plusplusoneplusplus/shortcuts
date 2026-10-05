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
    resolvedPath?: string;
    panel?: boolean;
    /** Desktop exposes the merged `browser` API with a `file` source. */
    merged?: boolean;
} = {}) {
    const path = options.path ?? htmlPath;
    document.body.innerHTML = `<div class="chat-message assistant" data-ws-id="${options.groupPreview ? 'group-one' : 'ws-local'}">
        <a href="${path}">Open page</a>
    </div>`;
    const open = vi.fn().mockResolvedValue(options.response ?? { ok: true });
    const close = vi.fn();
    const browser = {
        sources: ['url', 'file'],
        open: vi.fn().mockResolvedValue(options.response ?? { ok: true, engine: 'electron', sourceKind: 'file' }),
        close: vi.fn(),
        openViewExternal: vi.fn(),
    };
    if (options.desktop !== false) {
        Object.defineProperty(window, 'cocDesktop', {
            value: { isDesktop: true, htmlPage: { open, close }, ...(options.merged ? { browser } : {}) },
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
    fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ path: options.resolvedPath ?? options.groupPreview?.path ?? path }),
    });
    vi.stubGlobal('fetch', fetch);
    await import('../../../src/server/spa/client/react/shared/file-path/file-path-preview');
    const events: CustomEvent[] = [];
    const collect = (event: Event) => {
        if (event.type === 'coc-open-html-page' && options.panel !== false) {
            (event as CustomEvent<{ handled?: boolean }>).detail.handled = true;
        }
        events.push(event as CustomEvent);
    };
    window.addEventListener('coc-open-html-page', collect);
    window.addEventListener('coc-open-source-canvas', collect);
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(options.panel === false ? 2 : 1));
    window.removeEventListener('coc-open-html-page', collect);
    window.removeEventListener('coc-open-source-canvas', collect);
    return { events, open, close, fetch, browser };
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
        const { events, open } = await setup({ path: 'pages/index.html', resolvedPath: htmlPath });
        expect(open).toHaveBeenCalledWith('page-id', htmlPath);
        expect(events[0].type).toBe('coc-open-html-page');
        expect(events[0].detail).toEqual({
            pageId: 'page-id', filePath: htmlPath, wsId: 'ws-local',
            scopeWsId: 'ws-local', handled: true,
        });
    });

    it('opens a server-approved HTML file outside the workspace root', async () => {
        const approvedPath = 'C:/Users/test/.copilot/session/output.html';
        const { events, open, fetch } = await setup({ path: approvedPath });

        expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining(
            `/api/workspaces/ws-local/files/html/resolve?path=${encodeURIComponent(approvedPath)}`,
        ), expect.anything());
        expect(open).toHaveBeenCalledWith('page-id', approvedPath);
        expect(events[0].detail).toMatchObject({
            filePath: approvedPath,
            wsId: 'ws-local',
            scopeWsId: 'ws-local',
        });
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

    it('opens the page through the merged browser file source when the desktop advertises it', async () => {
        const { events, open, browser } = await setup({ merged: true });
        expect(open).not.toHaveBeenCalled();
        expect(browser.open).toHaveBeenCalledWith('html-page:page-id', { kind: 'file', path: htmlPath }, 'html-page');
        expect(events[0].type).toBe('coc-open-html-page');
        expect(events[0].detail.pageId).toBe('page-id');
    });

    it('falls back to the source viewer when the merged file source refuses the page', async () => {
        const { events, browser } = await setup({ merged: true, response: { ok: false, reason: 'missing' } });
        expect(browser.open).toHaveBeenCalledOnce();
        expect(events[0].type).toBe('coc-open-source-canvas');
    });

    it('keeps the source viewer in the browser', async () => {
        const { events, open } = await setup({ desktop: false });
        expect(open).not.toHaveBeenCalled();
        expect(events[0].type).toBe('coc-open-source-canvas');
    });

    it('closes a view and falls back when no right panel owns the link', async () => {
        const { events, close } = await setup({ panel: false });
        expect(events.map(event => event.type)).toEqual(['coc-open-html-page', 'coc-open-source-canvas']);
        expect(close).toHaveBeenCalledWith('page-id');
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
