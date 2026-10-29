import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { discoverCanvasExtensions } from '../../../src/server/canvas-extensions/discovery';
import { createRepoGroup, updateRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';

vi.mock('os', async importOriginal => {
    const actual = await importOriginal<typeof import('os')>();
    return { ...actual, homedir: vi.fn(actual.homedir) };
});

describe('canvas extension discovery', () => {
    let temporaryRoot: string;
    let home: string;
    let dataDir: string;
    let repoA: string;
    let repoB: string;
    let store: FileProcessStore;

    function extension(root: string, name: string, source = 'throw new Error("must never execute");'): string {
        const folder = path.join(root, name);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'extension.mjs'), source);
        return folder;
    }

    function discover(workspaceId = 'repo-a', enabled = true) {
        return discoverCanvasExtensions({ config: { canvasExtensions: { enabled } }, store, dataDir, workspaceId });
    }

    beforeEach(async () => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-discovery-'));
        home = path.join(temporaryRoot, 'home');
        dataDir = path.join(temporaryRoot, 'data');
        repoA = path.join(temporaryRoot, 'repo-a');
        repoB = path.join(temporaryRoot, 'repo-b');
        for (const root of [home, repoA, repoB]) fs.mkdirSync(root, { recursive: true });
        vi.mocked(os.homedir).mockReturnValue(home);
        store = new FileProcessStore({ dataDir });
        await store.registerWorkspace({ id: 'repo-a', name: 'A', rootPath: repoA });
        await store.registerWorkspace({ id: 'repo-b', name: 'B', rootPath: repoB });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('reads repo and real-home extensions without executing them', async () => {
        const folder = extension(path.join(repoA, '.github', 'extensions'), 'board');
        fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ description: ' Repo board ' }));
        const globalFolder = extension(path.join(home, '.copilot', 'extensions'), 'board');
        const results = await discover();
        expect(results).toEqual([
            expect.objectContaining({
                extensionKey: 'repo-a:board', ownerWorkspaceId: 'repo-a', name: 'board',
                extensionPath: path.join(folder, 'extension.mjs'), cwd: repoA, description: 'Repo board',
            }),
            expect.objectContaining({
                extensionKey: 'global:board', ownerWorkspaceId: 'global', name: 'board',
                extensionPath: path.join(globalFolder, 'extension.mjs'), cwd: globalFolder,
            }),
        ]);
        expect(results[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(results[1]).not.toHaveProperty('description');
    });

    it('does not use COPILOT_HOME for global discovery', async () => {
        const isolatedHome = path.join(temporaryRoot, 'canvas-ext', 'home');
        vi.stubEnv('COPILOT_HOME', isolatedHome);
        extension(path.join(isolatedHome, 'extensions'), 'hidden');
        extension(path.join(home, '.copilot', 'extensions'), 'visible');
        expect((await discover()).map(e => e.extensionKey)).toEqual(['global:visible']);
    });

    it('performs no registry, home, or filesystem reads when disabled or unset', async () => {
        const registry = vi.spyOn(store, 'getWorkspaces');
        const homeRead = vi.mocked(os.homedir);
        homeRead.mockClear();
        const directoryRead = vi.spyOn(fs.promises, 'readdir');
        const fileRead = vi.spyOn(fs.promises, 'readFile');
        const syncRead = vi.spyOn(fs, 'readFileSync');
        const exists = vi.spyOn(fs, 'existsSync');
        expect(await discover('group-disabled', false)).toEqual([]);
        expect(await discoverCanvasExtensions({ config: {}, store, dataDir, workspaceId: 'repo-a' })).toEqual([]);
        for (const spy of [registry, homeRead, directoryRead, fileRead, syncRead, exists]) {
            expect(spy).not.toHaveBeenCalled();
        }
    });

    it('unions live group members with member ownership and includes globals once', async () => {
        extension(path.join(repoA, '.github', 'extensions'), 'same');
        extension(path.join(repoB, '.github', 'extensions'), 'same');
        extension(path.join(home, '.copilot', 'extensions'), 'user');
        const group = await createRepoGroup(dataDir, store, { name: 'Team', members: ['repo-a', 'repo-b'] });
        extension(path.join(group.rootPath, '.github', 'extensions'), 'not-a-member');
        const results = await discover(group.id);
        expect(results.map(e => [e.extensionKey, e.cwd])).toEqual([
            ['repo-a:same', repoA], ['repo-b:same', repoB],
            ['global:user', path.join(home, '.copilot', 'extensions', 'user')],
        ]);
        await updateRepoGroup(dataDir, store, group.id, { members: ['repo-b'] });
        expect((await discover(group.id)).map(e => e.extensionKey)).toEqual(['repo-b:same', 'global:user']);
    });

    it('skips missing and deregistered group members', async () => {
        extension(path.join(repoA, '.github', 'extensions'), 'board');
        extension(path.join(repoB, '.github', 'extensions'), 'board');
        const group = await createRepoGroup(dataDir, store, { name: 'Team', members: ['repo-a', 'repo-b'] });
        fs.rmSync(repoA, { recursive: true });
        await store.removeWorkspace('repo-b');
        expect(await discover(group.id)).toEqual([]);
    });

    it('ignores missing entry points, non-files, and deeper packages', async () => {
        const root = path.join(repoA, '.github', 'extensions');
        fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
        fs.mkdirSync(path.join(root, 'directory', 'extension.mjs'), { recursive: true });
        fs.writeFileSync(path.join(root, 'file'), 'not a folder');
        extension(path.join(root, 'nested', 'deeper'), 'board');
        expect(await discover()).toEqual([]);
    });

    it('handles absent discovery roots and unknown or virtual workspaces', async () => {
        expect(await discover()).toEqual([]);
        await store.registerWorkspace({ id: 'virtual', name: 'Virtual', rootPath: repoA, virtual: true });
        extension(path.join(repoA, '.github', 'extensions'), 'board');
        expect(await discover('virtual')).toEqual([]);
        expect(await discover('unknown')).toEqual([]);
    });

    it('keeps hashes stable and invalidates them on entry point or metadata edits', async () => {
        const folder = extension(path.join(repoA, '.github', 'extensions'), 'board');
        const original = (await discover())[0].contentHash;
        expect((await discover())[0].contentHash).toBe(original);
        fs.appendFileSync(path.join(folder, 'extension.mjs'), '\n// changed');
        const changed = (await discover())[0].contentHash;
        expect(changed).not.toBe(original);
        fs.writeFileSync(path.join(folder, 'package.json'), '{"description":"new"}');
        expect((await discover())[0].contentHash).not.toBe(changed);
    });

    it.each(['{invalid', 'null', '[]', '{"description":42}', '{"description":"  "}'])(
        'tolerates optional metadata %s', async metadata => {
            const folder = extension(path.join(repoA, '.github', 'extensions'), 'board');
            fs.writeFileSync(path.join(folder, 'package.json'), metadata);
            const results = await discover();
            expect(results).toHaveLength(1);
            expect(results[0]).not.toHaveProperty('description');
        },
    );

    it('returns extensions in a stable folder order', async () => {
        const root = path.join(repoA, '.github', 'extensions');
        extension(root, 'z-last');
        extension(root, 'a-first');
        expect((await discover()).map(e => e.name)).toEqual(['a-first', 'z-last']);
    });

    it('surfaces read failures rather than reporting an empty catalog', async () => {
        const error = Object.assign(new Error('denied'), { code: 'EACCES' });
        vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(error);
        await expect(discover()).rejects.toBe(error);
    });
});
