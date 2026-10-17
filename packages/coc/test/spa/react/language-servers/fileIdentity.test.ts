// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileOpenQueue, resolveFileOpenPath, resolveOwnedFile } from '../../../../src/server/spa/client/react/features/language-servers/fileIdentity';
import { registerCloneBaseUrls, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { EMPTY_EXPLORER_TABS, openFileTab } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTabsModel';
import { EMPTY_UNIFIED_PANEL, openTab, visibleTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

const signal = () => new AbortController().signal;
const canonical = async (value: string) => value.toLowerCase() === 'src/mixed.ts' ? 'src/Mixed.ts' : value;
afterEach(() => { vi.unstubAllGlobals(); registerCloneBaseUrls([]); setActiveCloneForRouting(null); });

describe('owner-scoped file opens', () => {
    it.each([['src/Mixed.ts', 'src/mixed.ts'], ['src/mixed.ts', 'src/Mixed.ts']])('reuses tab and unsaved buffer in either order (%s)', async (first, second) => {
        let tabs = EMPTY_EXPLORER_TABS;
        const buffers = new Map<string, { text: string }>();
        const queue = new FileOpenQueue();
        const open = (path: string, line: number, column: number) => queue.open(path,
            () => tabs.tabs.map(tab => tab.path), canonical, path => {
                tabs = openFileTab(tabs, { path, name: path.split('/').pop()!, preview: false, line, column });
                if (!buffers.has(path)) buffers.set(path, { text: 'disk' });
            });
        await open(first, 1, 1);
        const buffer = buffers.get(tabs.tabs[0].path)!;
        buffer.text = 'unsaved edit';
        await open(second, 12, 17);
        expect(tabs.tabs).toHaveLength(1);
        expect(tabs.tabs[0]).toMatchObject({ path: 'src/Mixed.ts', line: 12, column: 17 });
        expect(buffers.get(tabs.tabs[0].path)).toBe(buffer);
        expect(buffer.text).toBe('unsaved edit');
        queue.dispose();
    });

    it('serializes simultaneous aliases before publishing either editing record', async () => {
        const queue = new FileOpenQueue();
        const records = new Map<string, object>();
        const paths: string[] = [];
        const open = (path: string) => queue.open(path, () => paths, canonical, path => {
            if (!records.has(path)) { records.set(path, {}); paths.push(path); }
        });
        await Promise.all([open('src/Mixed.ts'), open('src/mixed.ts'), open('SRC/MIXED.TS')]);
        expect(records.size).toBe(1);
        queue.dispose();
    });

    it('preserves distinct case-sensitive files', async () => {
        expect(await resolveFileOpenPath('Name.ts', ['name.ts'], async path => path)).toBe('Name.ts');
    });

    it('rechecks buffers added in place during pending identity resolution', async () => {
        const paths = ['src/Mixed.ts'];
        const queue = new FileOpenQueue();
        const commit = vi.fn();
        const resolve = async (value: string) => {
            if (paths.length === 1) paths.push('src/mixed.ts');
            return canonical(value);
        };
        await expect(queue.open('src/Mixed.ts', () => paths, resolve, commit)).rejects.toThrow('Multiple open buffers');
        expect(commit).not.toHaveBeenCalled();
        expect(paths).toEqual(['src/Mixed.ts', 'src/mixed.ts']);
        queue.dispose();
    });

    it('keeps pre-existing duplicate buffers untouched and stops even for an exact spelling', async () => {
        const existing = [{ path: 'src/Mixed.ts', text: 'first edit' }, { path: 'src/mixed.ts', text: 'second edit' }];
        const queue = new FileOpenQueue();
        const commit = vi.fn();
        await expect(queue.open('src/Mixed.ts', () => existing.map(entry => entry.path), canonical, commit)).rejects.toThrow('Multiple open buffers');
        expect(commit).not.toHaveBeenCalled();
        expect(existing.map(entry => entry.text)).toEqual(['first edit', 'second edit']);
        queue.dispose();
    });

    it('never publishes a cancelled or disposed owner request, even if I/O ignores abort', async () => {
        const queue = new FileOpenQueue();
        let finish!: (path: string) => void;
        const commit = vi.fn();
        const pending = queue.open('Name.ts', () => [], () => new Promise(resolve => { finish = resolve; }), commit);
        await Promise.resolve();
        queue.dispose();
        finish('Name.ts');
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(commit).not.toHaveBeenCalled();
    });

    it('a failed resolution creates nothing; a fresh retry succeeds', async () => {
        const queue = new FileOpenQueue();
        const commit = vi.fn();
        await expect(queue.open('Name.ts', () => [], async () => { throw new Error('offline'); }, commit)).rejects.toThrow('offline');
        expect(commit).not.toHaveBeenCalled();
        await queue.open('Name.ts', () => [], async path => path, commit);
        expect(commit).toHaveBeenCalledExactlyOnceWith('Name.ts', expect.any(AbortSignal));
        queue.dispose();
    });

    it('keeps equal paths in independent chats and clone owners separate', async () => {
        let state = EMPTY_UNIFIED_PANEL;
        for (const [chatId, ownerRoutingRef] of [['chat-a', 'clone-a'], ['chat-b', 'clone-a'], ['chat-a', 'clone-b']]) {
            const path = await resolveFileOpenPath('src/mixed.ts', [], canonical);
            state = openTab(state, { kind: 'file', chatId, ownerWorkspaceId: 'same-ws', ownerRoutingRef, resourceId: path, label: 'Mixed.ts' });
        }
        expect(visibleTabs(state, 'chat-a')).toHaveLength(2);
        expect(visibleTabs(state, 'chat-b')).toHaveLength(1);
    });

    it('routes colliding workspace IDs to the exact clone and rejects missing owners without fallback', async () => {
        const a = buildRemoteCloneKey('server-a', 'same-ws');
        const b = buildRemoteCloneKey('server-b', 'same-ws');
        registerCloneBaseUrls([{ workspaceId: 'same-ws', cloneKey: a, baseUrl: 'http://owner-a' }, { workspaceId: 'same-ws', cloneKey: b, baseUrl: 'http://owner-b' }]);
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ path: 'src/Mixed.ts' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetcher);
        await resolveOwnedFile({ workspaceId: 'same-ws', routingRef: b }, 'src/mixed.ts', signal());
        expect(String(fetcher.mock.calls[0][0])).toContain('http://owner-b/api/repos/same-ws/file-identity');
        expect(String(fetcher.mock.calls[0][0])).toContain('path=src%2Fmixed.ts');
        registerCloneBaseUrls([]);
        await expect(resolveOwnedFile({ workspaceId: 'same-ws', routingRef: b }, 'src/mixed.ts', signal())).rejects.toThrow('unavailable');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('rejects an owner changed during a delayed read', async () => {
        const ref = buildRemoteCloneKey('server', 'ws');
        registerCloneBaseUrls([{ workspaceId: 'ws', cloneKey: ref, baseUrl: 'http://first' }]);
        vi.stubGlobal('fetch', vi.fn(async () => {
            registerCloneBaseUrls([{ workspaceId: 'ws', cloneKey: ref, baseUrl: 'http://second' }]);
            return new Response(JSON.stringify({ path: 'Name.ts' }), { status: 200 });
        }));
        await expect(resolveOwnedFile({ workspaceId: 'ws', routingRef: ref }, 'name.ts', signal())).rejects.toThrow('changed');
    });

    it('rejects a route revoked and restored while an old read completes', async () => {
        const ref = buildRemoteCloneKey('server', 'ws');
        const entries = [{ workspaceId: 'ws', cloneKey: ref, baseUrl: 'http://owner' }];
        registerCloneBaseUrls(entries);
        vi.stubGlobal('fetch', vi.fn(async () => {
            registerCloneBaseUrls([]);
            registerCloneBaseUrls(entries);
            return new Response(JSON.stringify({ path: 'Name.ts' }), { status: 200 });
        }));
        await expect(resolveOwnedFile({ workspaceId: 'ws', routingRef: ref }, 'name.ts', signal())).rejects.toThrow('changed');
    });

    it.each(['../secret', '/absolute', 'C:/outside', 'a\0b', 'a//b'])('rejects an invalid identity response %s', async path => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ path }), { status: 200 })));
        await expect(resolveOwnedFile({ workspaceId: 'ws', routingRef: null }, 'name.ts', signal())).rejects.toThrow('Cannot confirm');
    });
});
