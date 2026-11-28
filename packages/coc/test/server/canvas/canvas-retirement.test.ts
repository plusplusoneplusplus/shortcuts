import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { registerCanvasRoutes } from '../../../src/server/canvas/canvas-routes';
import { removeManagedPath } from '../../../src/server/canvas-extensions/generated-packages';
import type { Route } from '../../../src/server/types';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

describe('unsupported artifact retirement', () => {
    let root: string, store: CanvasStore;
    beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-retire-'))); store = new CanvasStore(root); });
    afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
    it('removes only raw extension descriptors and their complete directory', () => {
        const old = store.createCanvas({ workspaceId: 'ws', title: 'old', content: 'old' });
        const keep = store.createCanvas({ workspaceId: 'ws', title: 'keep', content: 'keep' });
        const directory = (id: string) => path.join(root, 'repos', 'ws', 'canvases', id);
        for (const id of [old.id, keep.id]) {
            fs.mkdirSync(path.join(directory(id), 'extension'));
            fs.writeFileSync(path.join(directory(id), 'extension', 'attached'), 'keep only for document');
        }
        const descriptor = path.join(directory(old.id), 'canvas.json');
        fs.writeFileSync(descriptor, JSON.stringify({ ...old, type: 'extension' }));
        expect(store.listCanvases('ws').map(canvas => canvas.id)).toEqual([keep.id]);
        expect(fs.existsSync(directory(old.id))).toBe(false);
        expect(fs.existsSync(path.join(directory(keep.id), 'extension', 'attached'))).toBe(true);
        expect(store.listCanvases('ws').map(canvas => canvas.id)).toEqual([keep.id]);
    });
    it('keeps unknown and corrupt descriptors without guessing which files to delete', () => {
        const canvas = store.createCanvas({ workspaceId: 'ws', title: 'unknown', content: 'unknown' });
        const descriptor = path.join(root, 'repos', 'ws', 'canvases', canvas.id, 'canvas.json');
        fs.writeFileSync(descriptor, JSON.stringify({ ...canvas, type: 'unknown' }));
        expect(store.listCanvases('ws')).toEqual([]);
        expect(fs.existsSync(descriptor)).toBe(true);
        fs.writeFileSync(descriptor, '{');
        expect(store.listCanvases('ws')).toEqual([]);
        expect(fs.existsSync(descriptor)).toBe(true);
    });
    it('refuses recursive deletion through a symlink', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-outside-'));
        try {
            fs.writeFileSync(path.join(outside, 'keep'), 'keep');
            fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
            expect(() => removeManagedPath(root, path.join(root, 'escape'))).toThrow('symlink');
            expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('keep');
        } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    });
    it('registers no retired artifact or file routes', () => {
        const routes: Route[] = [];
        registerCanvasRoutes(routes, root);
        for (const suffix of ['extension', 'capabilities/bump', 'files', 'files/data.csv']) {
            const url = `/api/workspaces/ws/canvases/old/${suffix}`;
            expect(routes.some(route => route.pattern instanceof RegExp && route.pattern.test(url))).toBe(false);
        }
    });
    it('retries a failed retirement without marking it complete', () => {
        const canvas = store.createCanvas({ workspaceId: 'ws', title: 'retire', content: '{}' });
        const directory = path.join(root, 'repos', 'ws', 'canvases', canvas.id);
        fs.writeFileSync(path.join(directory, 'canvas.json'), JSON.stringify({ ...canvas, type: 'extension' }));
        const remove = vi.mocked(fs.rmSync).getMockImplementation()!;
        const spy = vi.mocked(fs.rmSync).mockImplementation((target, options) => {
            if (target === directory) throw Object.assign(new Error('locked canvas'), { code: 'EPERM' });
            return remove(target, options);
        });
        store.listCanvases('ws');
        expect(fs.existsSync(directory)).toBe(true);
        spy.mockRestore();
        store.listCanvases('ws');
        expect(fs.existsSync(directory)).toBe(false);
    });

});
