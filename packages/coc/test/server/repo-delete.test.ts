import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoTreeService } from '../../src/server/repos/tree-service';
import { registerRepoRoutes } from '../../src/server/repos/repo-routes';
import { createRouter } from '../../src/server/shared/router';
import type { Route } from '../../src/server/types';

let fixture: string;
let roots: string[];
let service: RepoTreeService;
let server: http.Server;
let base: string;
let enabled: boolean | undefined;

beforeEach(async () => {
    fixture = fs.mkdtempSync(path.resolve('.repo-delete-server-'));
    roots = ['one', 'two', 'group'].map(name => path.join(fixture, name));
    for (const root of roots) {
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'same.txt'), 'keep');
    }
    fs.writeFileSync(path.join(fixture, 'workspaces.json'), JSON.stringify(roots.map((rootPath, i) =>
        ({ id: `repo-${i}`, rootPath, virtual: i === 2 }))));
    service = new RepoTreeService(fixture);
    enabled = undefined;
    const routes: Route[] = [];
    registerRepoRoutes(routes, fixture, service, undefined, () => enabled === true);
    server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
});
afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    service.dispose();
    fs.rmSync(fixture, { recursive: true, force: true });
});

const remove = (id = 'repo-0', target = 'same.txt') =>
    fetch(`${base}/api/repos/${encodeURIComponent(id)}/entry?path=${encodeURIComponent(target)}`, { method: 'DELETE' });

describe('owning-server Explorer deletion', () => {
    it('defaults off for partial config, admits live enable, and refuses live disable', async () => {
        const attempt = vi.spyOn(service, 'deleteEntry');
        for (const flag of [undefined, false]) {
            enabled = flag;
            const response = await remove();
            expect(response.status).toBe(404);
            expect(await response.json()).toMatchObject({ code: 'EXPLORER_DELETE_DISABLED', partial: false, removedEntries: 0 });
        }
        expect(attempt).not.toHaveBeenCalled();
        enabled = true;
        expect(await (await remove()).json()).toEqual({ success: true });
        enabled = false;
        expect((await remove('repo-1')).status).toBe(404);
        expect(fs.readFileSync(path.join(roots[1], 'same.txt'), 'utf8')).toBe('keep');
    });

    it('deletes only the selected physical workspace and refreshes search', async () => {
        enabled = true;
        await service.listFilesRecursive('repo-0', '.');
        expect((await remove()).status).toBe(200);
        expect((await service.listFilesRecursive('repo-0', '.')).files).toEqual([]);
        expect((await service.searchFiles('repo-0', 'same')).results).toEqual([]);
        expect(fs.readFileSync(path.join(roots[1], 'same.txt'), 'utf8')).toBe('keep');
        expect((await remove('repo-1')).status).toBe(200);
    });

    it.each(['unknown', 'repo-2'])('rejects unresolved or virtual workspace %s without deletion', async id => {
        enabled = true;
        expect((await remove(id)).status).toBe(404);
        await expect(service.deleteEntry(id, 'same.txt')).rejects.toThrow('Repo not found');
        expect(fs.existsSync(path.join(roots[2], 'same.txt'))).toBe(true);
    });

    it('uses a re-registered live root instead of a previously warmed handle', async () => {
        enabled = true;
        await service.listFilesRecursive('repo-0', '.');
        fs.writeFileSync(path.join(fixture, 'workspaces.json'), JSON.stringify([
            { id: 'repo-0', rootPath: roots[1] },
        ]));
        expect((await remove()).status).toBe(200);
        expect(fs.readFileSync(path.join(roots[0], 'same.txt'), 'utf8')).toBe('keep');
        expect(fs.existsSync(path.join(roots[1], 'same.txt'))).toBe(false);
    });

    it('refuses a workspace made virtual after its handle was warmed', async () => {
        enabled = true;
        await service.listFilesRecursive('repo-0', '.');
        fs.writeFileSync(path.join(fixture, 'workspaces.json'), JSON.stringify([
            { id: 'repo-0', rootPath: roots[0], virtual: true },
        ]));
        expect((await remove()).status).toBe(404);
        await expect(service.deleteEntry('repo-0', 'same.txt')).rejects.toThrow('Repo not found');
        expect(fs.readFileSync(path.join(roots[0], 'same.txt'), 'utf8')).toBe('keep');
    });

    it.each(['.', '/', '../same.txt', '.git', 'folder/.git'])('rejects invalid/protected %s', async target => {
        enabled = true;
        const response = await remove('repo-0', target);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'INVALID_DELETE_PATH', partial: false, removedEntries: 0 });
        expect(fs.existsSync(path.join(roots[0], 'same.txt'))).toBe(true);
    });

    it('returns missing-target and missing-parameter errors explicitly', async () => {
        enabled = true;
        const response = await remove('repo-0', 'missing');
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'ENTRY_NOT_FOUND', partial: false, removedEntries: 0 });
        const missing = await fetch(`${base}/api/repos/repo-0/entry`, { method: 'DELETE' });
        expect(missing.status).toBe(400);
        expect(await missing.json()).toMatchObject({ code: 'INVALID_DELETE_PATH' });
    });

    it.each([
        ['ENTRY_CHANGED', 409, 0],
        ['DELETE_IO_ERROR', 500, 0],
        ['DELETE_IO_ERROR', 500, 2],
    ])('projects %s with %i and removal count %i without claiming rollback', async (code, status, removedEntries) => {
        enabled = true;
        vi.spyOn(service, 'deleteEntry').mockRejectedValue(Object.assign(new Error('Deletion failed; no rollback'), { code, removedEntries }));
        const response = await remove();
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({
            error: 'Deletion failed; no rollback', code, partial: removedEntries > 0, removedEntries,
        });
        expect(fs.existsSync(path.join(roots[0], 'same.txt'))).toBe(true);
    });

    it('surfaces an unavailable root instead of claiming success', async () => {
        enabled = true;
        fs.renameSync(roots[0], path.join(fixture, 'offline'));
        const response = await remove();
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: 'DELETE_IO_ERROR', partial: false, removedEntries: 0 });
    });
});
